/**
 * Award suggestions — a PURE READ over a season's results. Nothing here writes
 * a pin: the admin Awards Sheet shows these as one-click suggestions and a
 * human decides what gets saved. Ties are flagged (never silently collapsed)
 * and anything the data cannot answer is reported in `unresolved` with a
 * reason — e.g. S9 has no match_pokemon rows, so every stat-based pin there is
 * unresolved rather than empty.
 *
 * The winner-picking rules live in the pure pickers (auto-award-pickers.ts /
 * archive-mint-pickers.ts); this module only feeds them rows.
 */
import { db, schema } from '../../db';
import { and, eq, sql } from 'drizzle-orm';
import { matchWinner, computeStandings } from '../standings';
import {
  pickGarchompWinners, pickCannoliWinners, pickCynthiaWinners, computeStreak,
} from './auto-award-pickers';
import {
  pickChampion, pickHighScore, pickStealOfTheDraft, pickSweeper,
} from './archive-mint-pickers';

export interface Suggestion {
  pinDefId: string;
  leagueId: string;
  teamId: string;
  /** Canonical roster spelling when the pin is mon-headlined. */
  pokemon?: string;
  /** Set for per-match pins (kingslayer / flawless) and high-score. */
  matchId?: string;
  /** Derived stats shown in the tooltip (kills, wins, seriesScore, ...). */
  metadata: Record<string, unknown>;
  reason: string;
  /** More than one candidate is tied for this slot; admin may award several. */
  tie: boolean;
}

export interface UnresolvedSuggestion {
  pinDefId: string;
  leagueId: string;
  reason: 'no-stat-data' | 'no-eligible-matches' | 'unfinished-or-tied' | 'no-pokemon-met-kill-floor';
  detail: string;
}

export interface SuggestResult {
  seasonId: number;
  suggestions: Suggestion[];
  unresolved: UnresolvedSuggestion[];
}

const STAT_PINS = ['garchomp', 'high-score', 'steal-of-the-draft', 'sweeper', 'flawless', 'team-mvp'] as const;

type MatchRow = typeof schema.matches.$inferSelect;
type Push = (s: Omit<Suggestion, 'leagueId' | 'tie'>, tie: boolean) => void;

export function suggestAwards(seasonId: number, leagueId?: string): SuggestResult {
  const leagues = db.select().from(schema.leagues)
    .where(leagueId
      ? and(eq(schema.leagues.seasonId, seasonId), eq(schema.leagues.id, leagueId))
      : eq(schema.leagues.seasonId, seasonId)).all();
  const out: SuggestResult = { seasonId, suggestions: [], unresolved: [] };
  for (const l of leagues) suggestForLeague(l.id, out);
  return out;
}

function suggestForLeague(leagueId: string, out: SuggestResult) {
  const teams = db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all();
  if (teams.length === 0) return;
  const rankOf = new Map(teams.map(t => [t.id, t.rank]));
  const rosterNames = new Map<string, Map<string, string>>(); // teamId -> lower -> canonical
  for (const r of db.select({ t: schema.rosters.teamId, n: schema.rosters.pokemonName })
    .from(schema.rosters).innerJoin(schema.teams, eq(schema.teams.id, schema.rosters.teamId))
    .where(eq(schema.teams.leagueId, leagueId)).all()) {
    if (!rosterNames.has(r.t)) rosterNames.set(r.t, new Map());
    rosterNames.get(r.t)!.set(r.n.toLowerCase(), r.n);
  }
  const canon = (teamId: string, name: string) => rosterNames.get(teamId)?.get(name.toLowerCase()) ?? name;

  const push: Push = (s, tie) => { out.suggestions.push({ ...s, leagueId, tie }); };
  const unresolve = (pinDefId: string, reason: UnresolvedSuggestion['reason'], detail: string) => {
    out.unresolved.push({ pinDefId, leagueId, reason, detail });
  };

  const completed = db.select().from(schema.matches).where(and(
    eq(schema.matches.leagueId, leagueId), eq(schema.matches.status, 'completed'),
  )).all();
  const regular = completed.filter(m => m.phase === 'regular');

  // champion
  const finals = completed.filter(m => m.phase === 'playoffs' && m.playoffRound === 'f');
  const champ = finals.length ? pickChampion(finals) : null;
  if (champ) {
    push({
      pinDefId: 'champion', teamId: champ.winnerTeamId,
      metadata: { runnerUpTeamId: champ.loserTeamId, seriesScore: `${champ.winnerSum}-${champ.loserSum}` },
      reason: `Won the final ${champ.winnerSum}-${champ.loserSum}`,
    }, false);
  } else {
    unresolve('champion', finals.length ? 'unfinished-or-tied' : 'no-eligible-matches',
      finals.length ? 'The final is tied or unfinished' : 'No completed final');
  }

  // cannoli (best regular-season record)
  const standingsRank = new Map(computeStandings(leagueId).map((s, i) => [s.id, i + 1]));
  const records = teams.map(t => {
    let wins = 0, losses = 0, diff = 0, played = 0;
    for (const m of regular) {
      if (m.homeTeamId !== t.id && m.awayTeamId !== t.id) continue;
      if (m.homeScore == null || m.awayScore == null) continue;
      played++;
      const mine = m.homeTeamId === t.id ? m.homeScore : m.awayScore;
      const opp = m.homeTeamId === t.id ? m.awayScore : m.homeScore;
      diff += mine - opp;
      const w = matchWinner(m);
      if (w === t.id) wins++; else if (w != null) losses++;
    }
    return {
      teamId: t.id, userId: t.userId, wins, losses, diff, played,
      standingsRank: standingsRank.get(t.id) ?? Number.MAX_SAFE_INTEGER,
    };
  }).filter(r => r.played > 0);
  const cannoli = pickCannoliWinners(records, { keepTies: true });
  if (cannoli.length === 0) unresolve('cannoli', 'no-eligible-matches', 'No completed regular-season matches');
  for (const w of cannoli) {
    push({
      pinDefId: 'cannoli', teamId: w.teamId, metadata: { wins: w.wins, losses: w.losses, diff: w.diff },
      reason: `Best record ${w.wins}-${w.losses}, diff ${w.diff > 0 ? '+' : ''}${w.diff}`,
    }, cannoli.length > 1);
  }

  // cynthia (longest win streak)
  const ordered = [...regular].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));
  const streaks = teams.map(t => ({
    teamId: t.id, userId: t.userId, teamRank: rankOf.get(t.id) ?? null,
    best: computeStreak(ordered.filter(m => m.homeTeamId === t.id || m.awayTeamId === t.id), t.id),
  }));
  const cynthia = pickCynthiaWinners(streaks, 2, { keepTies: true });
  if (cynthia.length === 0) unresolve('cynthia', 'no-eligible-matches', 'No win streak of 2 or more');
  for (const s of cynthia) {
    push({ pinDefId: 'cynthia', teamId: s.teamId, metadata: { streak: s.best }, reason: `${s.best}-game win streak` },
      cynthia.length > 1);
  }

  // kingslayer: every qualifying match
  suggestKingslayer(regular, teams.map(t => t.id), push);

  // stat-based pins need per-Pokemon rows. S9 has none: say so, don't crash.
  const statCount = db.select({ c: sql<number>`COUNT(*)` }).from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
    .where(eq(schema.matches.leagueId, leagueId)).get()?.c ?? 0;
  if (statCount === 0) {
    for (const p of STAT_PINS) unresolve(p, 'no-stat-data', 'No per-Pokemon match stats recorded for this league');
    return;
  }

  // garchomp (most season kills on one Pokemon)
  const kills = db.select({
    teamId: schema.matchPokemon.teamId, pokemon: schema.matchPokemon.pokemonName,
    kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
    deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`,
  }).from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'regular'),
      eq(schema.matches.status, 'completed')))
    .groupBy(schema.matchPokemon.teamId, schema.matchPokemon.pokemonName).all();
  const garchomp = pickGarchompWinners(kills.map(r => ({
    teamId: r.teamId, pokemon: canon(r.teamId, r.pokemon), kills: r.kills, deaths: r.deaths,
    teamRank: rankOf.get(r.teamId) ?? null,
  })), { keepTies: true });
  if (garchomp.length === 0) unresolve('garchomp', 'no-eligible-matches', 'No kills recorded');
  for (const w of garchomp) {
    push({ pinDefId: 'garchomp', teamId: w.teamId, pokemon: w.pokemon, metadata: { kills: w.kills },
      reason: `${w.kills} KOs` }, garchomp.length > 1);
  }

  // team-mvp: each team's top-kill Pokemon
  const mvpByTeam = new Map<string, { pokemon: string; kills: number }[]>();
  for (const r of kills) {
    if (r.kills <= 0) continue;
    const cur = mvpByTeam.get(r.teamId) ?? [];
    const name = canon(r.teamId, r.pokemon);
    const hit = cur.find(c => c.pokemon.toLowerCase() === name.toLowerCase());
    if (hit) hit.kills += r.kills; else cur.push({ pokemon: name, kills: r.kills });
    mvpByTeam.set(r.teamId, cur);
  }
  for (const [teamId, list] of mvpByTeam) {
    const top = Math.max(...list.map(c => c.kills));
    const best = list.filter(c => c.kills === top);
    for (const c of best) {
      push({ pinDefId: 'team-mvp', teamId, pokemon: c.pokemon, metadata: { kills: c.kills },
        reason: `Team-best ${c.kills} KOs` }, best.length > 1);
    }
  }

  // high-score (most kills by one Pokemon in one match)
  const hs = db.select({
    pokemonName: schema.matchPokemon.pokemonName, teamId: schema.matchPokemon.teamId,
    matchId: schema.matchPokemon.matchId, kills: schema.matchPokemon.kills,
    deaths: schema.matchPokemon.deaths, week: schema.matches.week, phase: schema.matches.phase,
  }).from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.status, 'completed'))).all();
  const high = pickHighScore(hs.map(r => ({
    ...r, kills: r.kills ?? 0, deaths: r.deaths ?? 0, teamRank: rankOf.get(r.teamId) ?? null,
  })), { keepTies: true });
  if (high.length === 0) unresolve('high-score', 'no-eligible-matches', 'No kills recorded');
  for (const w of high) {
    push({
      pinDefId: 'high-score', teamId: w.teamId, pokemon: canon(w.teamId, w.pokemonName), matchId: w.matchId,
      metadata: { kills: w.kills, week: w.week, phase: w.phase },
      reason: `${w.kills} KOs in one match (week ${w.week})`,
    }, high.length > 1);
  }

  // steal-of-the-draft (best K per point on a drafted Pokemon)
  const steal = db.select({
    teamId: schema.matchPokemon.teamId, pokemonName: schema.matchPokemon.pokemonName,
    kills: sql<number>`COALESCE(SUM(${schema.matchPokemon.kills}), 0)`,
    gp: sql<number>`COUNT(*)`,
    cost: sql<number>`COALESCE(MAX(${schema.rosters.costAtDraft}), MAX(${schema.rosters.tier}))`,
  }).from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPokemon.matchId))
    .innerJoin(schema.rosters, and(eq(schema.rosters.teamId, schema.matchPokemon.teamId),
      eq(schema.rosters.pokemonName, schema.matchPokemon.pokemonName)))
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.status, 'completed'),
      eq(schema.rosters.acquiredVia, 'draft')))
    .groupBy(schema.matchPokemon.teamId, schema.matchPokemon.pokemonName).all();
  const steals = pickStealOfTheDraft(
    steal.map(r => ({ ...r, teamRank: rankOf.get(r.teamId) ?? null })), { keepTies: true });
  if (steals.length === 0) {
    unresolve('steal-of-the-draft', steal.length ? 'no-pokemon-met-kill-floor' : 'no-eligible-matches',
      steal.length ? 'No drafted Pokemon reached the kill floor' : 'No drafted Pokemon with recorded games');
  }
  for (const w of steals) {
    push({
      pinDefId: 'steal-of-the-draft', teamId: w.teamId, pokemon: canon(w.teamId, w.pokemonName),
      metadata: { kills: w.kills, cost: w.cost, ratio: w.ratio },
      reason: `${w.kills} KOs at ${w.cost}pt (${w.ratio} K/pt)`,
    }, steals.length > 1);
  }

  // sweeper (most flawless wins) + flawless (each flawless win)
  const sweepRows = completed.flatMap(m => {
    const winner = matchWinner(m);
    if (!winner || m.homeScore == null || m.awayScore == null) return [];
    const row = db.select({
      deaths: sql<number>`COALESCE(SUM(${schema.matchPokemon.deaths}), 0)`, gp: sql<number>`COUNT(*)`,
    }).from(schema.matchPokemon)
      .where(and(eq(schema.matchPokemon.matchId, m.id), eq(schema.matchPokemon.teamId, winner))).get();
    return [{
      match: m, matchId: m.id, winnerTeamId: winner, winnerGp: row?.gp ?? 0, winnerDeaths: row?.deaths ?? 0,
      teamRank: rankOf.get(winner) ?? null,
    }];
  });
  const sweepers = pickSweeper(sweepRows, { keepTies: true });
  if (sweepers.length === 0) unresolve('sweeper', 'no-eligible-matches', 'Nobody won a match without a loss');
  for (const w of sweepers) {
    push({ pinDefId: 'sweeper', teamId: w.teamId, metadata: { sweeps: w.sweeps }, reason: `${w.sweeps} flawless wins` },
      sweepers.length > 1);
  }
  for (const r of sweepRows) {
    if (r.winnerGp <= 0 || r.winnerDeaths > 0) continue;
    const m = r.match;
    push({
      pinDefId: 'flawless', teamId: r.winnerTeamId, matchId: r.matchId,
      metadata: { scoreLine: `${m.homeScore}-${m.awayScore}`, week: m.week },
      reason: `Won ${m.homeScore}-${m.awayScore} (week ${m.week}) with no losses`,
    }, false);
  }
}

/** Kingslayer: a bottom-half team beating a top-3 team, judged on the
 *  standings through that match's week. Lists EVERY qualifying match. */
function suggestKingslayer(regular: MatchRow[], teamIds: string[], push: Push) {
  const rankCache = new Map<number, Map<string, number>>();
  const ranksThrough = (week: number) => {
    const hit = rankCache.get(week);
    if (hit) return hit;
    const rec = new Map(teamIds.map(id => [id, { wins: 0, diff: 0 }]));
    for (const m of regular) {
      if (m.week > week || m.homeScore == null || m.awayScore == null) continue;
      if (!m.homeTeamId || !m.awayTeamId) continue;
      const w = matchWinner(m);
      const h = rec.get(m.homeTeamId), a = rec.get(m.awayTeamId);
      if (h) { h.diff += m.homeScore - m.awayScore; if (w === m.homeTeamId) h.wins++; }
      if (a) { a.diff += m.awayScore - m.homeScore; if (w === m.awayTeamId) a.wins++; }
    }
    const ranked = [...rec.entries()].sort((x, y) =>
      (y[1].wins - x[1].wins) || (y[1].diff - x[1].diff) || x[0].localeCompare(y[0]));
    const map = new Map(ranked.map(([id], i) => [id, i + 1]));
    rankCache.set(week, map);
    return map;
  };
  const half = Math.ceil(teamIds.length / 2);
  for (const m of regular) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const winner = matchWinner(m);
    if (!winner) continue;
    const loser = winner === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
    if (!loser) continue;
    const ranks = ranksThrough(m.week);
    const wr = ranks.get(winner), lr = ranks.get(loser);
    if (!wr || !lr || wr <= half || lr > 3) continue;
    push({
      pinDefId: 'kingslayer', teamId: winner, matchId: m.id,
      metadata: { loserTeamId: loser, winnerRank: wr, loserRank: lr, week: m.week },
      reason: `#${wr} seed beat #${lr} (week ${m.week})`,
    }, false);
  }
}
