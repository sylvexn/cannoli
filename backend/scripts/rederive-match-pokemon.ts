#!/usr/bin/env bun
/**
 * rederive-match-pokemon.ts — recompute per-Pokemon K/D for matches from their
 * stored `replay_log`, REPLACING the existing `match_pokemon` rows.
 *
 * Unlike backfill-match-pokemon.ts (which only fills matches that have NO rows),
 * this repairs matches whose rows were written by an OLDER parser. It exists for
 * the passive-status kill-attribution fix: burn/poison/toxic KOs used to be
 * credited to whoever last HIT the victim (or lost entirely when the victim
 * self-targeted, e.g. Destiny Bond) instead of whoever INFLICTED the status.
 * A re-parse also heals stale team-preview artefacts — a phantom "Greninja-*"
 * placeholder alongside the resolved "Greninja", or a missing Mega Lopunny whose
 * `|detailschange|` was mishandled — because the current parser reconciles them.
 *
 * SAFETY:
 *   - Scope is REQUIRED: pass --match <id> or --season <prefix>. There is no
 *     "rewrite the whole DB" mode.
 *   - Only matches WITH a `replay_log` are touched. Manual admin-form results
 *     carry no log (recordMatchResult never sets replay_log), so hand-entered
 *     K/D is never clobbered.
 *   - S9 leagues are skipped (the XLSX RawKills sheet is their source of truth).
 *   - Dry-run by default — prints a per-mon before/after diff. --apply writes.
 *   - Side→team mapping mirrors backfill-match-pokemon.ts (owner PS username,
 *     then |poke| roster overlap); a match that can't be mapped is skipped.
 *   - On apply, each match is rewritten in a transaction: delete its
 *     match_pokemon, insert the fresh rows, and null its brought_preview cache
 *     so the read side recomputes it from the corrected data.
 *
 *   bun run scripts/rederive-match-pokemon.ts --match s11-emerald-w1m2
 *   bun run scripts/rederive-match-pokemon.ts --match s11-emerald-w1m2 --apply
 *   bun run scripts/rederive-match-pokemon.ts --season s11- --apply
 */
import { db, schema } from '../src/db';
import { eq, and } from 'drizzle-orm';
import { tx } from '../src/lib/tx';
import { ReplayParser } from '../src/lib/replay-parser';
import { toUserid } from '../src/lib/ps-login';
import { resolveRosterPokemonName } from '../src/lib/pokedex';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const matchIdx = argv.indexOf('--match');
const matchId = matchIdx >= 0 ? argv[matchIdx + 1] : null;
const seasonIdx = argv.indexOf('--season');
const seasonPrefix = seasonIdx >= 0 ? argv[seasonIdx + 1] : null;

if (!matchId && !seasonPrefix) {
  console.error('Scope required: pass --match <id> or --season <prefix> (e.g. --season s11-).');
  process.exit(1);
}
if (matchIdx >= 0 && !matchId) {
  console.error('--match requires a match id argument, e.g. --match s11-emerald-w1m2');
  process.exit(1);
}
if (seasonIdx >= 0 && !seasonPrefix) {
  console.error('--season requires a prefix argument, e.g. --season s11-');
  process.exit(1);
}

console.log(`Mode:  ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
console.log(`Scope: ${matchId ? `match "${matchId}"` : `matchId prefix "${seasonPrefix}"`}\n`);

// S9 league ids — skipped (historical XLSX is source of truth).
const s9LeagueIds = new Set(
  db.select({ id: schema.leagues.id })
    .from(schema.leagues)
    .innerJoin(schema.seasons, eq(schema.leagues.seasonId, schema.seasons.id))
    .where(eq(schema.seasons.seasonNumber, 9))
    .all()
    .map(r => r.id),
);

// Candidate matches: have a replay_log, in scope, not S9.
const candidates = db.select({
  id: schema.matches.id,
  leagueId: schema.matches.leagueId,
  homeTeamId: schema.matches.homeTeamId,
  awayTeamId: schema.matches.awayTeamId,
  replayLog: schema.matches.replayLog,
}).from(schema.matches).all().filter(m =>
  m.replayLog != null &&
  m.homeTeamId != null &&
  m.awayTeamId != null &&
  !s9LeagueIds.has(m.leagueId) &&
  (matchId ? m.id === matchId : m.id.startsWith(seasonPrefix!)),
);

console.log(`Found ${candidates.length} candidate match(es) with a replay_log in scope.\n`);

// Per-team caches (unchanged during the run).
const rosterCache = new Map<string, string[]>();
const rosterNamesFor = (teamId: string): string[] => {
  let names = rosterCache.get(teamId);
  if (!names) {
    names = db.select({ name: schema.rosters.pokemonName })
      .from(schema.rosters)
      .where(eq(schema.rosters.teamId, teamId))
      .all()
      .map(r => r.name);
    rosterCache.set(teamId, names);
  }
  return names;
};
const ownerUseridCache = new Map<string, string>();
const ownerUseridFor = (teamId: string): string => {
  let uid = ownerUseridCache.get(teamId);
  if (uid === undefined) {
    const row = db.select({ username: schema.users.username })
      .from(schema.teams)
      .leftJoin(schema.users, eq(schema.users.id, schema.teams.userId))
      .where(eq(schema.teams.id, teamId))
      .get();
    uid = row?.username ? toUserid(row.username) : '';
    ownerUseridCache.set(teamId, uid);
  }
  return uid;
};

/** Map PS sides (p1/p2) → Cannoli team ids. Owner username first, roster overlap
 *  as tiebreak/fallback (mirrors backfill-match-pokemon.ts). null when unresolved. */
function mapSides(
  result: ReturnType<typeof ReplayParser.parse>,
  homeTeamId: string,
  awayTeamId: string,
): { p1: string; p2: string } | null {
  const homeUid = ownerUseridFor(homeTeamId);
  const awayUid = ownerUseridFor(awayTeamId);
  const p1Uid = toUserid(result.players.p1 || '');
  const p2Uid = toUserid(result.players.p2 || '');

  let p1Team: string | null = null;
  let p2Team: string | null = null;
  if (homeUid && p1Uid === homeUid) p1Team = homeTeamId;
  else if (awayUid && p1Uid === awayUid) p1Team = awayTeamId;
  if (homeUid && p2Uid === homeUid) p2Team = homeTeamId;
  else if (awayUid && p2Uid === awayUid) p2Team = awayTeamId;

  if (!p1Team || !p2Team) {
    const homeRoster = new Set(rosterNamesFor(homeTeamId).map(s => s.toLowerCase()));
    const awayRoster = new Set(rosterNamesFor(awayTeamId).map(s => s.toLowerCase()));
    const p1Mons = result.pokemon.filter(p => p.player === 'p1').map(p => p.species.toLowerCase());
    const p2Mons = result.pokemon.filter(p => p.player === 'p2').map(p => p.species.toLowerCase());
    const score = (mons: string[], roster: Set<string>) =>
      mons.reduce((n, s) => n + (roster.has(s) ? 1 : 0), 0);
    const p1HomeP2Away = score(p1Mons, homeRoster) + score(p2Mons, awayRoster);
    const p1AwayP2Home = score(p1Mons, awayRoster) + score(p2Mons, homeRoster);
    if (p1HomeP2Away > p1AwayP2Home && p1HomeP2Away > 0) {
      p1Team ??= homeTeamId; p2Team ??= awayTeamId;
    } else if (p1AwayP2Home > p1HomeP2Away && p1AwayP2Home > 0) {
      p1Team ??= awayTeamId; p2Team ??= homeTeamId;
    }
  }
  if (!p1Team || !p2Team || p1Team === p2Team) return null;
  return { p1: p1Team, p2: p2Team };
}

interface NewRow { teamId: string; pokemonName: string; kills: number; deaths: number; teraUsed: boolean; teraType: string | null; }

let rewritten = 0;
let skippedNoMap = 0;
let skippedParse = 0;
let unchanged = 0;

for (const m of candidates) {
  let result;
  try {
    result = ReplayParser.parse(m.replayLog!);
  } catch (err) {
    console.warn(`[parse-error] ${m.id}: ${(err as Error).message}`);
    skippedParse++;
    continue;
  }

  const sides = mapSides(result, m.homeTeamId!, m.awayTeamId!);
  if (!sides) {
    console.warn(`[skip] ${m.id}: could not map PS sides (p1=${result.players.p1 || '?'} p2=${result.players.p2 || '?'}) — left untouched`);
    skippedNoMap++;
    continue;
  }

  const newRows: NewRow[] = result.pokemon
    .filter(p => p.appeared)
    .map(p => {
      const teamId = p.player === 'p1' ? sides.p1 : sides.p2;
      return {
        teamId,
        pokemonName: resolveRosterPokemonName(rosterNamesFor(teamId), p.species),
        kills: p.kills,
        deaths: p.deaths,
        teraUsed: p.teraUsed,
        teraType: p.teraType,
      };
    });

  // Current rows for the diff.
  const oldRows = db.select({
    teamId: schema.matchPokemon.teamId,
    pokemonName: schema.matchPokemon.pokemonName,
    kills: schema.matchPokemon.kills,
    deaths: schema.matchPokemon.deaths,
    teraUsed: schema.matchPokemon.teraUsed,
    teraType: schema.matchPokemon.teraType,
  }).from(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, m.id)).all();

  const key = (r: { teamId: string; pokemonName: string }) => `${r.teamId}|${r.pokemonName}`;
  const oldByKey = new Map(oldRows.map(r => [key(r), r]));
  const newByKey = new Map(newRows.map(r => [key(r), r]));

  const changeLines: string[] = [];
  for (const [k, nr] of newByKey) {
    const or = oldByKey.get(k);
    if (!or) {
      changeLines.push(`   + ${nr.pokemonName.padEnd(16)} K=${nr.kills} D=${nr.deaths}  (new)`);
    } else if (or.kills !== nr.kills || or.deaths !== nr.deaths || or.teraUsed !== nr.teraUsed || (or.teraType ?? null) !== (nr.teraType ?? null)) {
      changeLines.push(`   ~ ${nr.pokemonName.padEnd(16)} K=${or.kills}→${nr.kills} D=${or.deaths}→${nr.deaths}`);
    }
  }
  for (const [k, or] of oldByKey) {
    if (!newByKey.has(k)) changeLines.push(`   - ${or.pokemonName.padEnd(16)} K=${or.kills} D=${or.deaths}  (removed)`);
  }

  if (changeLines.length === 0) {
    unchanged++;
    continue;
  }

  console.log(`${m.id}  (${result.players.p1} vs ${result.players.p2})`);
  changeLines.forEach(l => console.log(l));
  console.log('');

  if (APPLY) {
    tx(() => {
      db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, m.id)).run();
      for (const nr of newRows) {
        db.insert(schema.matchPokemon).values({
          matchId: m.id,
          teamId: nr.teamId,
          pokemonName: nr.pokemonName,
          kills: nr.kills,
          deaths: nr.deaths,
          teraUsed: nr.teraUsed,
          teraType: nr.teraType,
        }).run();
      }
      // Force the brought-preview cache to recompute from the corrected data.
      db.update(schema.matches).set({ broughtPreview: null })
        .where(eq(schema.matches.id, m.id)).run();
    });
    rewritten++;
  }
}

console.log('── Summary ──');
console.log(`  candidates:         ${candidates.length}`);
console.log(`  unchanged:          ${unchanged}`);
console.log(`  ${APPLY ? 'rewritten:          ' : 'would rewrite:      '}${APPLY ? rewritten : candidates.length - unchanged - skippedNoMap - skippedParse}`);
console.log(`  skipped (no map):   ${skippedNoMap}`);
console.log(`  skipped (parse):    ${skippedParse}`);
if (!APPLY && candidates.length - unchanged - skippedNoMap - skippedParse > 0) {
  console.log('\nRe-run with --apply to write these changes.');
}
