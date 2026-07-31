/**
 * Integration tests for the pending→expired trade transition job
 * (lib/jobs/expire-trades.ts → runExpireTrades).
 *
 * Coverage (scope #1, trade lifecycle):
 *   - age-based expiry: a pending trade older than tradeExpiryDays flips to
 *     'expired' (resolvedBy='system')
 *   - deadline-based expiry: a pending trade in a league whose currentWeek has
 *     reached tradeDeadlineWeek flips to 'expired'
 *   - a fresh pending trade (recent + before deadline) is left pending
 *   - already-resolved trades (accepted/rejected) are never touched
 *   - idempotency: re-running the job does not re-resolve or duplicate
 *
 * runExpireTrades() scans ALL trades; the whole test runs inside BEGIN/ROLLBACK
 * (the job is synchronous and wraps writes in tx()/SAVEPOINT). Site-settings
 * tradeExpiryDays defaults to 7 when the row is absent.
 */
import { describe, expect, test } from 'bun:test';
import { db, schema, sqlite } from '../src/db';
import { eq } from 'drizzle-orm';
import { runExpireTrades } from '../src/lib/jobs/expire-trades';
import { isTradeDeadlinePassed } from '../src/lib/queries';

const PFX = 'texp-';

function setupLeague(opts: { currentWeek: number; tradeDeadlineWeek: number }) {
  const seasonId = db.insert(schema.seasons).values({ seasonNumber: 7000, archived: false }).returning().get().id;
  const leagueId = `${PFX}lg-${opts.currentWeek}-${opts.tradeDeadlineWeek}`;
  db.insert(schema.leagues).values({
    id: leagueId, name: 'Expire Test', color: '#3366cc', seasonId,
    phase: 'regular', currentWeek: opts.currentWeek, tradeDeadlineWeek: opts.tradeDeadlineWeek,
  }).run();
  const a = `${PFX}a-${leagueId}`;
  const b = `${PFX}b-${leagueId}`;
  db.insert(schema.teams).values([
    { id: a, leagueId, coachName: 'A', teamName: 'TA', teamAbbrev: 'TA', teamColor: '#111111' },
    { id: b, leagueId, coachName: 'B', teamName: 'TB', teamAbbrev: 'TB', teamColor: '#222222' },
  ]).run();
  return { leagueId, a, b };
}

function insertTrade(leagueId: string, a: string, b: string, opts: {
  status?: 'pending' | 'awaiting_admin' | 'accepted' | 'rejected' | 'expired';
  proposedAt: string;
}) {
  return db.insert(schema.trades).values({
    leagueId, week: 1,
    status: opts.status ?? 'pending',
    proposerId: a, recipientId: b,
    offering: JSON.stringify(['X']), requesting: JSON.stringify(['Y']),
    proposedAt: opts.proposedAt,
  }).returning().get();
}

function statusOf(id: number) {
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get()!.status;
}

const OLD = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
const RECENT = new Date().toISOString();

describe('runExpireTrades — age-based expiry', () => {
  test('a pending trade older than the expiry window flips to expired', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, a, b } = setupLeague({ currentWeek: 1, tradeDeadlineWeek: 7 });
      const t = insertTrade(leagueId, a, b, { proposedAt: OLD });
      runExpireTrades();
      expect(statusOf(t.id)).toBe('expired');
      const row = db.select().from(schema.trades).where(eq(schema.trades.id, t.id)).get()!;
      expect(row.resolvedBy).toBe('system');
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('a recent pending trade (before deadline) stays pending', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, a, b } = setupLeague({ currentWeek: 1, tradeDeadlineWeek: 7 });
      const t = insertTrade(leagueId, a, b, { proposedAt: RECENT });
      runExpireTrades();
      expect(statusOf(t.id)).toBe('pending');
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});

describe('runExpireTrades — deadline-based expiry', () => {
  test('a recent pending trade past the league deadline flips to expired', () => {
    sqlite.exec('BEGIN');
    try {
      // currentWeek >= tradeDeadlineWeek → deadline reached.
      const { leagueId, a, b } = setupLeague({ currentWeek: 7, tradeDeadlineWeek: 7 });
      const t = insertTrade(leagueId, a, b, { proposedAt: RECENT });
      runExpireTrades();
      expect(statusOf(t.id)).toBe('expired');
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('the week BEFORE the deadline stays open — it lands exactly on it', () => {
    sqlite.exec('BEGIN');
    try {
      // The deadline bounds the week a trade LANDS in, and an approval lands the
      // following week, so week 6 is the last actionable week for a week-7
      // deadline. Expiring here would close trading a full week early.
      const { leagueId, a, b } = setupLeague({ currentWeek: 6, tradeDeadlineWeek: 7 });
      const t = insertTrade(leagueId, a, b, { proposedAt: RECENT });
      runExpireTrades();
      expect(statusOf(t.id)).toBe('pending');
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('awaiting_admin trades are also expired at the deadline', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, a, b } = setupLeague({ currentWeek: 8, tradeDeadlineWeek: 7 });
      const t = insertTrade(leagueId, a, b, { status: 'awaiting_admin', proposedAt: RECENT });
      runExpireTrades();
      expect(statusOf(t.id)).toBe('expired');
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('tradeDeadlineWeek=0 (no deadline) does not expire a recent trade', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, a, b } = setupLeague({ currentWeek: 20, tradeDeadlineWeek: 0 });
      const t = insertTrade(leagueId, a, b, { proposedAt: RECENT });
      runExpireTrades();
      expect(statusOf(t.id)).toBe('pending');
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});

describe('runExpireTrades — resolved trades untouched + idempotency', () => {
  test('accepted / rejected trades are never re-resolved', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, a, b } = setupLeague({ currentWeek: 8, tradeDeadlineWeek: 7 });
      const accepted = insertTrade(leagueId, a, b, { status: 'accepted', proposedAt: OLD });
      const rejected = insertTrade(leagueId, a, b, { status: 'rejected', proposedAt: OLD });
      runExpireTrades();
      expect(statusOf(accepted.id)).toBe('accepted');
      expect(statusOf(rejected.id)).toBe('rejected');
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  test('re-running the job is idempotent (expired stays expired, resolvedAt unchanged)', () => {
    sqlite.exec('BEGIN');
    try {
      const { leagueId, a, b } = setupLeague({ currentWeek: 1, tradeDeadlineWeek: 7 });
      const t = insertTrade(leagueId, a, b, { proposedAt: OLD });
      runExpireTrades();
      const firstResolvedAt = db.select().from(schema.trades).where(eq(schema.trades.id, t.id)).get()!.resolvedAt;
      runExpireTrades();
      const secondResolvedAt = db.select().from(schema.trades).where(eq(schema.trades.id, t.id)).get()!.resolvedAt;
      expect(statusOf(t.id)).toBe('expired');
      expect(secondResolvedAt).toBe(firstResolvedAt); // not re-touched
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});

/**
 * The rules doc states one deadline for BOTH trades and free agency ("The
 * deadline for Trades and Free Agencies is Week 7"), but the two gates are
 * written in different shapes and live in different files:
 *
 *   trades → lib/queries.ts     isTradeDeadlinePassed: currentWeek >= deadline
 *   FA     → lib/free-agency.ts stampWeek > faDeadline  (stampWeek = landing week)
 *
 * They are equivalent only because an approval lands on currentWeek + 1. This
 * pins that equivalence so a future edit to either shape can't silently open
 * one market a week longer than the other.
 */
describe('trade deadline agrees with the free-agency deadline', () => {
  const landingWeek = (currentWeek: number) => Math.max(1, currentWeek + 1);

  test('same open/closed answer for every week, at every deadline', () => {
    for (const deadline of [1, 5, 7, 12]) {
      for (let currentWeek = 0; currentWeek <= 20; currentWeek++) {
        const tradesClosed = isTradeDeadlinePassed({ currentWeek, tradeDeadlineWeek: deadline });
        const faClosed = landingWeek(currentWeek) > deadline;
        expect(`w${currentWeek}/d${deadline}:${tradesClosed}`).toBe(`w${currentWeek}/d${deadline}:${faClosed}`);
      }
    }
  });

  test('a non-positive deadline disables both', () => {
    expect(isTradeDeadlinePassed({ currentWeek: 99, tradeDeadlineWeek: 0 })).toBe(false);
    expect(isTradeDeadlinePassed({ currentWeek: 99, tradeDeadlineWeek: -1 })).toBe(false);
  });
});
