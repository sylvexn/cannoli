/**
 * Replay summary (MVP / sweep / teras / score line / 12-mon grid) shared by the
 * single-match and bulk-league endpoints. Pure over preloaded rows so the bulk
 * path costs a fixed number of queries regardless of how many matches a league has.
 */
import { db, schema } from '../db';
import { eq, inArray } from 'drizzle-orm';
import { matchListCols } from './queries';
import { computeBroughtPreviewFromLog, type BroughtSides } from './brought-preview';

type MatchRow = Omit<typeof schema.matches.$inferSelect, 'replayLog'>;
export type RosterLite = { pokemonName: string; nickname: string | null; isShiny: boolean };
type Entry = {
  teamId: string; pokemonName: string; kills: number; deaths: number;
  teraUsed: boolean; teraType: string | null; nickname: string | null; isShiny: boolean;
};
type DisplayMon = {
  name: string; nickname: string | null; isShiny: boolean;
  kills: number; deaths: number; teraUsed: boolean; teraType: string | null;
};

function chunks<T>(a: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

/** Load roster rows for the given teams, grouped by team id. */
export function loadRosterLite(teamIds: string[]): Map<string, RosterLite[]> {
  const byTeam = new Map<string, RosterLite[]>();
  for (const ids of chunks([...new Set(teamIds)])) {
    for (const r of db.select({
      teamId: schema.rosters.teamId,
      pokemonName: schema.rosters.pokemonName,
      nickname: schema.rosters.nickname,
      isShiny: schema.rosters.isShiny,
    }).from(schema.rosters).where(inArray(schema.rosters.teamId, ids)).all()) {
      const a = byTeam.get(r.teamId) ?? [];
      a.push({ pokemonName: r.pokemonName, nickname: r.nickname ?? null, isShiny: !!r.isShiny });
      byTeam.set(r.teamId, a);
    }
  }
  return byTeam;
}

/** match_pokemon rows for the given matches, grouped by match id. */
export function loadMatchPokemon(matchIds: string[]) {
  const byMatch = new Map<string, (typeof schema.matchPokemon.$inferSelect)[]>();
  for (const ids of chunks(matchIds)) {
    for (const r of db.select().from(schema.matchPokemon).where(inArray(schema.matchPokemon.matchId, ids)).all()) {
      const a = byMatch.get(r.matchId) ?? [];
      a.push(r);
      byMatch.set(r.matchId, a);
    }
  }
  return byMatch;
}

export function buildReplaySummary(
  match: MatchRow,
  rawEntries: (typeof schema.matchPokemon.$inferSelect)[],
  rosters: Map<string, RosterLite[]>,
) {
  // nickname + shiny per (team, species); traded-out mons just get null/false.
  const rosterMap = (teamId: string | null) => {
    const map = new Map<string, RosterLite>();
    for (const r of (teamId ? rosters.get(teamId) : undefined) ?? []) map.set(r.pokemonName.toLowerCase(), r);
    return map;
  };
  const homeRosterMap = rosterMap(match.homeTeamId);
  const awayRosterMap = rosterMap(match.awayTeamId);
  const entries: Entry[] = rawEntries.map(e => {
    const r = (e.teamId === match.homeTeamId ? homeRosterMap : e.teamId === match.awayTeamId ? awayRosterMap : rosterMap(e.teamId))
      .get(e.pokemonName.toLowerCase());
    // exact-name join in the original; rosters store the canonical name so a lowercase match is equivalent
    return {
      teamId: e.teamId, pokemonName: e.pokemonName, kills: e.kills, deaths: e.deaths,
      teraUsed: e.teraUsed, teraType: e.teraType, nickname: r?.nickname ?? null, isShiny: !!r?.isShiny,
    };
  });

  const homeMons = entries.filter(e => e.teamId === match.homeTeamId);
  const awayMons = entries.filter(e => e.teamId === match.awayTeamId);

  // MVP — top kill-getter across both teams, ties broken by lower deaths
  const allMons = [...homeMons, ...awayMons];
  const mvpEntry = allMons.length > 0
    ? allMons.reduce((best, m) => {
        if (m.kills > best.kills) return m;
        if (m.kills === best.kills && m.deaths < best.deaths) return m;
        return best;
      })
    : null;
  const mvp = mvpEntry ? {
    name: mvpEntry.pokemonName,
    nickname: mvpEntry.nickname ?? null,
    isShiny: !!mvpEntry.isShiny,
    kills: mvpEntry.kills,
    deaths: mvpEntry.deaths,
    teamId: mvpEntry.teamId,
  } : null;

  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const isComplete = match.homeScore != null && match.awayScore != null;

  const teraCount = entries.filter(e => e.teraUsed).length;
  const sweep = isComplete && (
    (homeScore === 6 && awayScore === 0) ||
    (awayScore === 6 && homeScore === 0)
  );

  // Full 12-mon grid: merge brought team-of-6 (incl. benched mons) with the
  // real appeared K/D from match_pokemon. K/D / MVP / teraCount / sweep above
  // stay sourced purely from match_pokemon (appeared-only).
  const toDisplay = (m: Entry): DisplayMon => ({
    name: m.pokemonName, nickname: m.nickname ?? null, isShiny: !!m.isShiny,
    kills: m.kills, deaths: m.deaths, teraUsed: m.teraUsed, teraType: m.teraType,
  });

  // Resolve the brought sides: cached column → lazy re-parse of replayLog
  // (self-healing the cache) → null (legacy/sim rows fall back below).
  let brought: BroughtSides | null = null;
  if (match.broughtPreview) {
    try {
      const parsed = JSON.parse(match.broughtPreview);
      if (parsed && Array.isArray(parsed.home) && Array.isArray(parsed.away)) {
        brought = parsed as BroughtSides;
      }
    } catch { /* malformed cache → recompute below if a log exists */ }
  }
  if (!brought) {
    // Only touch the heavy replay_log column on a cache miss.
    const log = db.select({ l: schema.matches.replayLog }).from(schema.matches)
      .where(eq(schema.matches.id, match.id)).get()?.l;
    if (log) {
      const homeRoster = (match.homeTeamId ? rosters.get(match.homeTeamId) : undefined)?.map(r => r.pokemonName) ?? [];
      const awayRoster = (match.awayTeamId ? rosters.get(match.awayTeamId) : undefined)?.map(r => r.pokemonName) ?? [];
      const computed = computeBroughtPreviewFromLog(log, {
        recorded: entries.map(e => ({ teamId: e.teamId, pokemonName: e.pokemonName })),
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        homeRoster,
        awayRoster,
      });
      if (computed) {
        brought = computed;
        // Persist back so the next read skips the parse. Never break the read.
        try {
          db.update(schema.matches)
            .set({ broughtPreview: JSON.stringify(computed) })
            .where(eq(schema.matches.id, match.id))
            .run();
        } catch { /* self-heal best-effort */ }
      }
    }
  }

  let home: DisplayMon[];
  let away: DisplayMon[];
  if (brought) {
    // K/D lookup keyed by lowercased Cannoli species, per team.
    const kdByTeam = new Map<string, Map<string, Entry>>();
    for (const e of entries) {
      let m = kdByTeam.get(e.teamId);
      if (!m) { m = new Map(); kdByTeam.set(e.teamId, m); }
      m.set(e.pokemonName.toLowerCase(), e);
    }
    const buildSide = (
      species: string[],
      kd: Map<string, Entry> | undefined,
      roster: Map<string, RosterLite>,
    ): DisplayMon[] => species.map(name => {
      const key = name.toLowerCase();
      const k = kd?.get(key);
      const r = roster.get(key);
      return {
        name,
        nickname: r?.nickname ?? null,
        isShiny: r?.isShiny ?? false,
        kills: k?.kills ?? 0,
        deaths: k?.deaths ?? 0,
        teraUsed: k?.teraUsed ?? false,
        teraType: k?.teraType ?? null,
      };
    });
    home = buildSide(brought.home, match.homeTeamId ? kdByTeam.get(match.homeTeamId) : undefined, homeRosterMap);
    away = buildSide(brought.away, match.awayTeamId ? kdByTeam.get(match.awayTeamId) : undefined, awayRosterMap);
  } else {
    // Legacy / sim / undecidable: appeared-only.
    home = homeMons.map(toDisplay);
    away = awayMons.map(toDisplay);
  }

  return {
    matchId: match.id,
    isComplete,
    mvp,
    teraCount,
    sweep,
    // Margin of victory; useful for "blowout" / "nailbiter" classification
    margin: Math.abs(homeScore - awayScore),
    scoreLine: isComplete ? `${homeScore}-${awayScore}` : null,
    home,
    away,
  };
}

/** Single match: loads its own rows. */
export function replaySummaryForMatch(match: MatchRow) {
  const teamIds = [match.homeTeamId, match.awayTeamId].filter((x): x is string => !!x);
  const entries = db.select().from(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, match.id)).all();
  return buildReplaySummary(match, entries, loadRosterLite(teamIds));
}

/** Whole league: fixed query count. `canSee` applies the results-reveal gate. */
export function replaySummariesForLeague(leagueId: string, canSee: (m: MatchRow) => boolean) {
  const matches = db.select(matchListCols).from(schema.matches)
    .where(eq(schema.matches.leagueId, leagueId))
    .all()
    .filter(m => m.status === 'completed' && canSee(m));
  const rosters = loadRosterLite(matches.flatMap(m => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x));
  const pokes = loadMatchPokemon(matches.map(m => m.id));
  const out: Record<string, ReturnType<typeof buildReplaySummary>> = {};
  for (const m of matches) out[m.id] = buildReplaySummary(m, pokes.get(m.id) ?? [], rosters);
  return out;
}
