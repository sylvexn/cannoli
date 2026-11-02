import { test, expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import { canActOnRole } from '../src/lib/auth-guards';
import { feedbackRateLimited } from '../src/routes/feedback';
import { checkLeagueArchived } from '../src/lib/archive-guard';
import { checkLockout, recordFailure, clearAttempts } from '../src/lib/login-limiter';
import { db, schema } from '../src/db';

test('canActOnRole: admin cannot touch dev/bot/admin; dev can', () => {
  expect(canActOnRole({ role: 'admin' }, 'user')).toBe(true);
  for (const r of ['admin', 'bot', 'dev']) expect(canActOnRole({ role: 'admin' }, r)).toBe(false);
  expect(canActOnRole({ role: 'dev' }, 'dev')).toBe(true);
});

test('feedback limiter: 6th submit in window is blocked', () => {
  const t = Date.now();
  for (let i = 0; i < 5; i++) expect(feedbackRateLimited('u-test', t)).toBe(false);
  expect(feedbackRateLimited('u-test', t)).toBe(true);
  expect(feedbackRateLimited('u-test', t + 11 * 60 * 1000)).toBe(false);
});

test('login limiter locks after 5 failures', () => {
  const ip = '9.9.9.9';
  for (let i = 0; i < 5; i++) recordFailure(ip, 'x');
  expect(checkLockout(ip)).toBeGreaterThan(0);
  clearAttempts(ip);
});

test('archive force only bypasses for staff', () => {
  const lg = db.select({ id: schema.leagues.id }).from(schema.leagues)
    .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
    .where(eq(schema.seasons.archived, true)).get();
  if (!lg) return; // no archived season in this test DB
  expect(checkLeagueArchived(lg.id, '1', { role: 'user' })).not.toBeNull();
  expect(checkLeagueArchived(lg.id, '1')).not.toBeNull();
  expect(checkLeagueArchived(lg.id, '1', { role: 'admin' })).toBeNull();
});
