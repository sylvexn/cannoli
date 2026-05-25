/**
 * Integration tests for the auto-forfeit scheduler job (lib/jobs/auto-forfeit.ts
 * → runAutoForfeit) and its interaction with standings (lib/standings.ts).
 *
 * Extends auto-forfeit.test.ts (which only covers the pure effectiveMatchDeadline
 * helper) and coordinates with standings-disputed.test.ts (which proves disputed
 * matches don't count). Here we drive the FULL job end-to-end and assert the
 * match-row outcomes, then feed those outcomes into computeStandings.
 *
 * Coverage (scope #3):
 *   - regular-season double_forfeit policy → 0-0 completed, forfeitedBy='both'
 *   - regular-season admin_review policy → status='disputed', not counted in standings
 *   - a not-yet-overdue match is left untouched
 *   - a paused league is skipped entirely
 *
 * runAutoForfeit() scans EVERY league's overdue matches, so the whole test runs
 * inside BEGIN/ROLLBACK (the job is fully synchronous and wraps its writes in
 * tx()/SAVEPOINT, which nests cleanly inside an outer BEGIN). Nothing is left
 * behind in the seeded DB.
 */
import { describe, expect, test } from 'bun:test';
import { db, schema, sqlite } from '../src/db';
import { eq } from 'drizzle-orm';
import { runAutoForfeit } from '../src/lib/jobs/auto-forfeit';
import { computeStandings } from '../src/lib/standings';

const PFX = 'taff-';
const PAST = '2000-01-01T00:00:00.000Z';   // long past — always overdue
const FUTURE = '2999-01-01T00:00:00.000Z';  // never overdue

/**
 * Stand up an isolated season + league + two teams with a controllable
 * forfeit policy. Returns ids. Caller is inside a BEGIN/ROLLBACK.
 */
function setupLeague(policy: 'double_forfeit' | 'admin_review', opts: { paused?: boolean } = {}) {
  const seasonId = db.insert(schema.seasons).values({ seasonNumber: 8000, archived: false }).returning().get().id;
  const leagueId = `${PFX}lg-${policy}${opts.paused ? '-paused' : ''}`;
  db.insert(schema.leagues).values({
    id: leagueId, name: 'AFF Test', color: '#3366cc', seasonId,
    phase: 'regular', currentWeek: 5, totalWeeks: 11,
    forfeitPolicy: policy, paused: opts.paused ?? false,
  }).run();
  const home = `${PFX}home-${leagueId}`;
  const away = `${PFX}away-${leagueId}`;
  db.insert(schema.teams).values([
    { id: home, leagueId, coachName: 'H', teamName: 'Home', teamAbbrev: 'HM', teamColor: '#111111' },
    { id: away, leagueId, coachName: 'A', teamName: 'Away', teamAbbrev: 'AW', teamColor: '#222222' },
  ]).run();
  return { seasonId, leagueId, home, away };
}

function insertMatch(leagueId: string, home: string, away: string, opts: {
  id: string; deadline: string | null; status?: 'scheduled' | 'ready'; week?: number;
}) {
  db.insert(schema.matches).values({
    id: opts.id, leagueId, week: opts.week ?? 5,
    homeTeamId: home, awayTeamId: away,
    homeScore: null, awayScore: null,
    status: opts.status ?? 'scheduled', phase: 'regular',
    deadline: opts.deadline,
  }).run();
}

function getMatch(id: string) {
  return db.select().from(schema.matches).where(eq(schema.matches.id, id)).get()!;
}

describe('runAutoForfeit — regular-season outcomes', () => {
  test('double_forfeit: overdue match becomes 0-0 completed, forfeitedBy=both', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, home, away } = setupLeague('double_forfeit');
      insertMatch(leagueId, home, away, { id: `${PFX}m-df`, deadline: PAST });

      runAutoForfeit();

      const m = getMatch(`${PFX}m-df`);
      expect(m.status).toBe('completed');
      expect(m.homeScore).toBe(0);
      expect(m.awayScore).toBe(0);
      expect(m.forfeitedBy).toBe('both');
      expect(m.completedAt).toBeTruthy();
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('admin_review: overdue match becomes disputed (no scores), with a warning', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, home, away } = setupLeague('admin_review');
      insertMatch(leagueId, home, away, { id: `${PFX}m-ar`, deadline: PAST });

      runAutoForfeit();

      const m = getMatch(`${PFX}m-ar`);
      expect(m.status).toBe('disputed');
      expect(m.homeScore).toBeNull();
      expect(m.awayScore).toBeNull();
      expect(m.warnings).toMatch(/admin review/i);
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('not-yet-overdue match is left scheduled', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, home, away } = setupLeague('double_forfeit');
      insertMatch(leagueId, home, away, { id: `${PFX}m-future`, deadline: FUTURE });

      runAutoForfeit();

      const m = getMatch(`${PFX}m-future`);
      expect(m.status).toBe('scheduled');
      expect(m.forfeitedBy).toBeNull();
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('paused league is skipped (overdue match untouched)', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, home, away } = setupLeague('double_forfeit', { paused: true });
      insertMatch(leagueId, home, away, { id: `${PFX}m-paused`, deadline: PAST });

      runAutoForfeit();

      const m = getMatch(`${PFX}m-paused`);
      expect(m.status).toBe('scheduled');
      expect(m.forfeitedBy).toBeNull();
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});

describe('runAutoForfeit ↔ standings integration', () => {
  test('double-forfeit 0-0 counts as a completed match (a loss for nobody, 0 PF/PA)', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, home, away } = setupLeague('double_forfeit');
      insertMatch(leagueId, home, away, { id: `${PFX}m-std-df`, deadline: PAST });
      runAutoForfeit();

      const standings = computeStandings(leagueId);
      const h = standings.find(r => r.id === home);
      const a = standings.find(r => r.id === away);
      expect(h).toBeDefined();
      expect(a).toBeDefined();
      // 0-0 completed: neither side gets a win; PF/PA both 0.
      expect(h!.wins).toBe(0);
      expect(a!.wins).toBe(0);
      expect(h!.kills).toBe(0);
      expect(h!.deaths).toBe(0);
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('admin_review disputed match does NOT contribute to standings', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, home, away } = setupLeague('admin_review');
      insertMatch(leagueId, home, away, { id: `${PFX}m-std-ar`, deadline: PAST });
      runAutoForfeit();

      // Confirm it's disputed, then assert standings ignore it entirely.
      expect(getMatch(`${PFX}m-std-ar`).status).toBe('disputed');

      const standings = computeStandings(leagueId);
      const h = standings.find(r => r.id === home);
      const a = standings.find(r => r.id === away);
      expect(h!.wins + h!.losses).toBe(0);
      expect(a!.wins + a!.losses).toBe(0);
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});
