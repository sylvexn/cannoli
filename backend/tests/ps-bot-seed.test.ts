/**
 * Verify the bot-user seeder is idempotent.
 *
 * The chat plugin gates `/cannoli-battle` on a row with `user.id ===
 * 'cannolibot'`. We boot the seeder on every backend startup, so it MUST be
 * safe to re-run — otherwise we'd duplicate-key on the username unique index
 * (or worse, silently insert orphan duplicates if the index were ever
 * dropped).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { ensureBotUser } from '../src/lib/ps-bot-seed';

const BOT_USERNAME = process.env.BOT_USERNAME || 'CannoliBot';

function countBotRows(): number {
  return db.select().from(schema.users)
    .where(eq(schema.users.username, BOT_USERNAME))
    .all().length;
}

describe('ensureBotUser', () => {
  // Clean slate: remove any pre-existing bot row from prior runs so the test
  // exercises both the create-path and the idempotent re-run-path.
  beforeAll(() => {
    db.delete(schema.users).where(eq(schema.users.username, BOT_USERNAME)).run();
  });

  afterAll(() => {
    db.delete(schema.users).where(eq(schema.users.username, BOT_USERNAME)).run();
  });

  test('creates the cannolibot user on first call', () => {
    expect(countBotRows()).toBe(0);
    const first = ensureBotUser();
    expect(first.created).toBe(true);
    expect(first.username).toBe(BOT_USERNAME);
    expect(countBotRows()).toBe(1);
  });

  test('second call is a no-op: still exactly one row', () => {
    const second = ensureBotUser();
    expect(second.created).toBe(false);
    expect(countBotRows()).toBe(1);
  });

  test('the seeded user has mustChangePassword=false and role=user', () => {
    const row = db.select().from(schema.users)
      .where(eq(schema.users.username, BOT_USERNAME))
      .get();
    expect(row).toBeTruthy();
    expect(row!.mustChangePassword).toBe(false);
    expect(row!.role).toBe('user');
    expect(row!.active).toBe(true);
    // Hash should be a non-trivial bcrypt-style string, not the plaintext.
    expect(row!.passwordHash.length).toBeGreaterThan(20);
    expect(row!.passwordHash).not.toBe(process.env.BOT_PASSWORD || 'cannolibot');
  });
});
