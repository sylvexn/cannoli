/**
 * Shared DB fixture builder for draft-engine concurrency / timer tests.
 *
 * The backend's `db` is a single on-disk SQLite file shared by every `bun test`
 * process (see backend/src/db/index.ts — DB_PATH is fixed). The established
 * convention in this repo's tests is therefore NOT to spin up an isolated DB
 * but to write rows under unique, never-reused ids and clean them up after.
 *
 * This helper stamps out a minimal-but-complete draft world:
 *   season (reusing the seeded pointCap/teraCaptainSlots) → league(phase=draft)
 *   → N teams (each with a userId so canSubscribeToLeague resolves) → draftState.
 *
 * Pokemon are NOT inserted — we reuse the seeded national-dex (1195 rows). Tests
 * that need a known tier pull a real seeded mon by tier via `pickByTier`.
 */
import { db, schema, sqlite } from '../src/db';
import { eq } from 'drizzle-orm';

// The dev DB is a single on-disk SQLite file shared by every test process (and,
// during launch-prep, by sibling agent worktrees running seeds). Without a busy
// timeout, a concurrent writer makes get()/run() throw SQLITE_BUSY immediately.
// Raise the timeout so our short transactions wait for the lock instead.
try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

let counter = 0;

export interface DraftFixture {
  seasonId: number;
  leagueId: string;
  teamIds: string[];
  pointCap: number;
  teraCaptainSlots: number;
  rosterSize: number;
  cleanup: () => void;
}

/**
 * Build a fresh draft fixture. `status` controls the initial draftState row.
 * `timerStartedAt` lets a test backdate the timer to simulate expiry without a
 * real wall-clock sleep.
 */
export function buildDraftFixture(opts?: {
  teams?: number;
  rosterSize?: number;
  status?: 'not_started' | 'in_progress' | 'paused' | 'completed';
  timerDuration?: number;
  timerStartedAt?: Date | null;
  currentPickIndex?: number;
  timerExpiredForTeam?: string | null;
  teraCaptainSlots?: number;
}): DraftFixture {
  const id = ++counter;
  const tag = `dtf-${id}-${Date.now()}`;
  const numTeams = opts?.teams ?? 4;
  const rosterSize = opts?.rosterSize ?? 10;
  const teraCaptainSlots = opts?.teraCaptainSlots ?? 0;

  // Reuse a real season's pointCap; create our own season row so we control
  // teraCaptainSlots (and don't disturb the seeded seasons).
  const baseSeason = db.select().from(schema.seasons).where(eq(schema.seasons.id, 2)).get()
    ?? db.select().from(schema.seasons).all()[0];
  const pointCap = baseSeason?.pointCap ?? 110;

  const seasonRow = db.insert(schema.seasons).values({
    seasonNumber: 9000 + id,
    pointCap,
    teraCaptainSlots,
    archived: false,
  }).returning().get();
  const seasonId = seasonRow.id;

  const teamIds: string[] = [];
  for (let i = 0; i < numTeams; i++) teamIds.push(`${tag}-t${i}`);

  const leagueId = `${tag}-lg`;
  db.insert(schema.leagues).values({
    id: leagueId,
    name: `Fixture League ${id}`,
    color: '#123456',
    seasonId,
    draftOrder: JSON.stringify(teamIds),
    phase: 'draft',
    rosterSize,
  }).run();

  for (let i = 0; i < numTeams; i++) {
    db.insert(schema.teams).values({
      id: teamIds[i],
      leagueId,
      userId: 900000 + id * 100 + i, // synthetic, unique
      coachName: `Coach ${i}`,
      teamName: `Team ${i}`,
      teamAbbrev: `t${i}`,
      captainsLocked: false,
    }).run();
  }

  const status = opts?.status ?? 'in_progress';
  const startedIso =
    opts?.timerStartedAt === null
      ? null
      : (opts?.timerStartedAt ?? new Date()).toISOString();

  db.insert(schema.draftState).values({
    leagueId,
    status,
    currentPickIndex: opts?.currentPickIndex ?? 0,
    timerDuration: opts?.timerDuration ?? 120,
    timerStartedAt: status === 'in_progress' ? startedIso : (opts?.timerStartedAt === undefined ? null : startedIso),
    startedAt: new Date().toISOString(),
    timerExpiredForTeam: opts?.timerExpiredForTeam ?? null,
  }).run();

  const cleanup = () => {
    db.delete(schema.draftPicks).where(eq(schema.draftPicks.leagueId, leagueId)).run();
    for (const t of teamIds) {
      db.delete(schema.rosters).where(eq(schema.rosters.teamId, t)).run();
    }
    db.delete(schema.draftState).where(eq(schema.draftState.leagueId, leagueId)).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueId)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
  };

  return { seasonId, leagueId, teamIds, pointCap, teraCaptainSlots, rosterSize, cleanup };
}

/** A real seeded, unbanned, base-form Pokemon name of the given tier. */
const usedByTier = new Map<number, string[]>();
export function pickByTier(tier: number, skip: string[] = []): string {
  const rows = db.select().from(schema.pokemon)
    .where(eq(schema.pokemon.tier, tier))
    .all()
    .filter(p => !p.banned && p.formCategory === 'base' && !skip.includes(p.name));
  if (rows.length === 0) throw new Error(`no seeded tier-${tier} pokemon available`);
  return rows[0].name;
}

/** Backdate a timestamp by `seconds`. */
export function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}
