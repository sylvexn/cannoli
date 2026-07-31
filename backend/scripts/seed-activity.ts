/**
 * Seed realistic late-season activity for the three S10 leagues.
 *
 *   bun run scripts/seed-activity.ts
 *
 * Why this exists: the regular seed leaves activity_log nearly empty for the
 * active S10 leagues. The League Overview feed (`league-overview.tsx`) renders
 * up to 24 events filtered to draft|trade|match|team — without seed activity,
 * the feed shows the empty state on a finals-pending dataset that should look
 * full of recent action.
 *
 * What it inserts (~30 events, drawn from real seeded matches/transactions):
 *
 *   - 6 SF match_results (most recent — May 5–6 2026)
 *   - 3 tera_captains_updated for SF teams adjusting before semis (May 3–4)
 *   - 12 QF match_results (Apr 27–30)
 *   - 3 playoffs_generated events with real bracket seedings (Apr 22)
 *   - 2 W11 sweep highlights from real matches (Apr 18–20)
 *   - 3 late-season FA pickups from real transactions (Apr 13–17)
 *
 * Idempotent: wipes existing activity_log rows for sapphire|ruby|emerald
 * leagues before inserting (keeps S9 pin/admin rows untouched).
 *
 * Metadata shapes mirror `frontend/src/lib/activity-events.ts` so the typed
 * EventDescription renderer produces entity-linked prose. Description strings
 * mirror what live route handlers write so the admin activity-log page reads
 * cleanly too.
 */

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { resolve } from 'path';
import * as schema from '../src/db/schema';

const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');
const S10_LEAGUES = ['sapphire', 'ruby', 'emerald'] as const;

const sqlite = new Database(DB_PATH);
sqlite.exec('PRAGMA foreign_keys = ON;');
const db = drizzle(sqlite, { schema });

// Helpers

type Row = typeof schema.activityLog.$inferInsert;

function iso(date: string, time = '20:00:00'): string {
  return `${date}T${time}Z`;
}

function loadCoachByTeam(): Map<string, string> {
  const rows = sqlite.prepare(`
    SELECT t.id as team_id, u.username
    FROM teams t LEFT JOIN users u ON u.id = t.user_id
    WHERE t.league_id IN ('sapphire','ruby','emerald')
  `).all() as Array<{ team_id: string; username: string | null }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.username) map.set(r.team_id, r.username);
  }
  return map;
}

function loadTeamMeta(): Map<string, { teamName: string; coachName: string }> {
  const rows = sqlite.prepare(`
    SELECT id, team_name, coach_name FROM teams WHERE league_id IN ('sapphire','ruby','emerald')
  `).all() as Array<{ id: string; team_name: string; coach_name: string }>;
  const map = new Map<string, { teamName: string; coachName: string }>();
  for (const r of rows) map.set(r.id, { teamName: r.team_name, coachName: r.coach_name });
  return map;
}

function loadPlayoffMatches() {
  return sqlite.prepare(`
    SELECT id, league_id, week, home_team_id, away_team_id, home_score, away_score,
           playoff_round, home_seed, away_seed
    FROM matches
    WHERE league_id IN ('sapphire','ruby','emerald')
      AND status='completed' AND phase='playoffs'
    ORDER BY league_id, week, id
  `).all() as Array<{
    id: string; league_id: string; week: number;
    home_team_id: string; away_team_id: string;
    home_score: number; away_score: number;
    playoff_round: string; home_seed: number; away_seed: number;
  }>;
}

function loadBracketSeedings(): Map<string, Array<{ seed: number; teamId: string }>> {
  const rows = sqlite.prepare(`
    SELECT league_id, home_team_id AS team_id, home_seed AS seed FROM matches
    WHERE phase='playoffs' AND playoff_round='qf' AND league_id IN ('sapphire','ruby','emerald')
    UNION
    SELECT league_id, away_team_id AS team_id, away_seed AS seed FROM matches
    WHERE phase='playoffs' AND playoff_round='qf' AND league_id IN ('sapphire','ruby','emerald')
  `).all() as Array<{ league_id: string; team_id: string; seed: number }>;
  const out = new Map<string, Array<{ seed: number; teamId: string }>>();
  for (const r of rows) {
    if (!out.has(r.league_id)) out.set(r.league_id, []);
    out.get(r.league_id)!.push({ seed: r.seed, teamId: r.team_id });
  }
  for (const arr of out.values()) arr.sort((a, b) => a.seed - b.seed);
  return out;
}

function loadW11Sweeps() {
  return sqlite.prepare(`
    SELECT id, league_id, week, home_team_id, away_team_id, home_score, away_score
    FROM matches
    WHERE league_id IN ('sapphire','ruby','emerald')
      AND status='completed' AND phase='regular' AND week=11
      AND ((home_score=6 AND away_score=0) OR (home_score=0 AND away_score=6))
    ORDER BY league_id
    LIMIT 4
  `).all() as Array<{
    id: string; league_id: string; week: number;
    home_team_id: string; away_team_id: string;
    home_score: number; away_score: number;
  }>;
}

function loadLateFA() {
  return sqlite.prepare(`
    SELECT id, league_id, week, team_id, pokemon_in, pokemon_out
    FROM transactions
    WHERE league_id IN ('sapphire','ruby','emerald')
      AND type='fa' AND week=8
      AND pokemon_in IS NOT NULL
    ORDER BY league_id, id DESC
  `).all() as Array<{
    id: number; league_id: string; week: number;
    team_id: string; pokemon_in: string; pokemon_out: string | null;
  }>;
}

function loadCaptainPicks(teamId: string): string[] {
  // Pull a few high-tier picks per team as plausible tera-captain candidates.
  // We don't track captain identity post-import, so pick the team's three
  // priciest draftables as the captain shortlist for the metadata payload —
  // the renderer just needs the team and a non-empty captains array.
  const rows = sqlite.prepare(`
    SELECT pokemon_name, tier FROM draft_picks
    WHERE team_id=?
    ORDER BY tier DESC, id ASC
    LIMIT 3
  `).all(teamId) as Array<{ pokemon_name: string; tier: number }>;
  return rows.map(r => r.pokemon_name);
}

// Build events

const coachByTeam = loadCoachByTeam();
const teamMeta = loadTeamMeta();
const playoffMatches = loadPlayoffMatches();
const bracketSeedings = loadBracketSeedings();
const w11Sweeps = loadW11Sweeps();
const lateFA = loadLateFA();

// Pick a representative SF survivor per league for a pre-SF tera adjustment.
// (Real S10 doesn't track captain edits, so we synthesize one per league
// timestamped between QF wrap and SF kickoff.)
const PRE_SF_TERA_TEAMS: Record<string, string> = {
  sapphire: 'sapphire-dwg', // 5-seed cinderella
  ruby: 'ruby-egg',         // 1-seed
  emerald: 'emerald-abs',   // 1-seed
};

const events: Row[] = [];

// Match-result builder.
function pushMatchResult(
  m: { id: string; league_id: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number },
  ts: string,
) {
  const home = teamMeta.get(m.home_team_id);
  const away = teamMeta.get(m.away_team_id);
  const actor = coachByTeam.get(m.home_team_id) || coachByTeam.get(m.away_team_id) || 'system';
  events.push({
    type: 'match_result',
    category: 'match',
    actor,
    leagueId: m.league_id,
    description: `Recorded result for ${home?.teamName ?? m.home_team_id} vs ${away?.teamName ?? m.away_team_id}: ${m.home_score}-${m.away_score}`,
    metadata: JSON.stringify({
      matchId: m.id,
      homeScore: m.home_score,
      awayScore: m.away_score,
      warningCount: 0,
    }),
    timestamp: ts,
  });
}

// 1. FA scrambles (Apr 13–17)
const FA_SLOTS = [
  { date: '2026-04-13', time: '21:30:00' },
  { date: '2026-04-15', time: '19:45:00' },
  { date: '2026-04-17', time: '22:10:00' },
];
// Pick one FA per league, latest week available.
const faPicked: Array<typeof lateFA[number]> = [];
for (const lid of S10_LEAGUES) {
  const candidate = lateFA.find(f => f.league_id === lid);
  if (candidate) faPicked.push(candidate);
}
faPicked.forEach((fa, i) => {
  const slot = FA_SLOTS[i] ?? FA_SLOTS[FA_SLOTS.length - 1];
  const team = teamMeta.get(fa.team_id);
  const actor = coachByTeam.get(fa.team_id) ?? 'syl';
  events.push({
    type: 'fa_pickup',
    category: 'fa',
    actor,
    leagueId: fa.league_id,
    description: `FA: ${team?.teamName ?? fa.team_id} picked up ${fa.pokemon_in}${fa.pokemon_out ? `, dropped ${fa.pokemon_out}` : ''}`,
    metadata: JSON.stringify({
      teamId: fa.team_id,
      pokemonName: fa.pokemon_in,
      dropPokemonName: fa.pokemon_out ?? null,
    }),
    timestamp: iso(slot.date, slot.time),
  });
});

// 2. W11 regular-season sweeps (Apr 18–20)
const SWEEP_SLOTS = [
  { date: '2026-04-18', time: '18:30:00' },
  { date: '2026-04-19', time: '20:00:00' },
  { date: '2026-04-20', time: '19:15:00' },
  { date: '2026-04-20', time: '21:45:00' },
];
w11Sweeps.forEach((m, i) => {
  const slot = SWEEP_SLOTS[i] ?? SWEEP_SLOTS[SWEEP_SLOTS.length - 1];
  pushMatchResult(m, iso(slot.date, slot.time));
});

// 3. Playoffs generated × 3 (Apr 22)
const PLAYOFFS_GEN_TIMES = ['16:00:00', '16:05:00', '16:10:00'];
S10_LEAGUES.forEach((lid, i) => {
  const seedings = bracketSeedings.get(lid) ?? [];
  events.push({
    type: 'playoffs_generated',
    category: 'match',
    actor: 'syl',
    leagueId: lid,
    description: `Generated ${seedings.length}-team playoff bracket`,
    metadata: JSON.stringify({
      seedCount: seedings.length,
      seedings,
    }),
    timestamp: iso('2026-04-22', PLAYOFFS_GEN_TIMES[i]),
  });
});

// 4. QF match_results (Apr 27–30)
const qfs = playoffMatches.filter(m => m.playoff_round === 'qf');
// Stagger 12 QF results across 4 evenings (Mon–Thu of playoff week 12).
const QF_SLOTS = [
  '2026-04-27T19:00:00Z', '2026-04-27T20:30:00Z', '2026-04-27T22:00:00Z', '2026-04-27T23:15:00Z',
  '2026-04-28T19:30:00Z', '2026-04-28T21:00:00Z', '2026-04-28T22:30:00Z',
  '2026-04-29T20:00:00Z', '2026-04-29T21:30:00Z',
  '2026-04-30T19:45:00Z', '2026-04-30T21:15:00Z', '2026-04-30T22:45:00Z',
];
qfs.forEach((m, i) => pushMatchResult(m, QF_SLOTS[i] ?? QF_SLOTS[QF_SLOTS.length - 1]));

// 5. Pre-SF tera adjustments (May 3–4)
const TERA_SLOTS = ['2026-05-03T18:30:00Z', '2026-05-03T20:00:00Z', '2026-05-04T17:15:00Z'];
S10_LEAGUES.forEach((lid, i) => {
  const teamId = PRE_SF_TERA_TEAMS[lid];
  if (!teamId) return;
  const captains = loadCaptainPicks(teamId);
  if (captains.length === 0) return;
  const team = teamMeta.get(teamId);
  const actor = coachByTeam.get(teamId) ?? 'syl';
  events.push({
    type: 'tera_captains_updated',
    category: 'team',
    actor,
    leagueId: lid,
    description: `Updated tera captains for ${team?.teamName ?? teamId}`,
    metadata: JSON.stringify({ teamId, captains }),
    timestamp: TERA_SLOTS[i],
  });
});

// 6. SF match_results (May 5–6) — most recent
const sfs = playoffMatches.filter(m => m.playoff_round === 'sf');
const SF_SLOTS = [
  '2026-05-05T19:00:00Z', '2026-05-05T20:30:00Z', '2026-05-05T22:00:00Z',
  '2026-05-06T19:30:00Z', '2026-05-06T21:00:00Z', '2026-05-06T22:30:00Z',
];
sfs.forEach((m, i) => pushMatchResult(m, SF_SLOTS[i] ?? SF_SLOTS[SF_SLOTS.length - 1]));

// Insert

console.log(`Built ${events.length} activity events for S10 backfill.`);

// Wipe existing rows for the three S10 leagues. Pin/admin rows for s9-* and
// rows with no leagueId stay untouched.
const wiped = sqlite.prepare(`
  DELETE FROM activity_log WHERE league_id IN ('sapphire','ruby','emerald')
`).run();
console.log(`  wiped ${wiped.changes} existing S10 activity rows`);

// Bulk insert (single-statement transaction via bun:sqlite).
const insertMany = sqlite.transaction((rows: Row[]) => {
  for (const evt of rows) {
    db.insert(schema.activityLog).values(evt).run();
  }
});
insertMany(events);

const inserted = sqlite.prepare(`
  SELECT COUNT(*) AS c FROM activity_log
  WHERE league_id IN ('sapphire','ruby','emerald')
`).get() as { c: number };
console.log(`  inserted ${inserted.c} new S10 activity rows`);
console.log('Done.');
