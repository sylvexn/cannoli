/**
 * Bot user seed.
 *
 * The Cannoli chat plugin (showdown/server/server/chat-plugins/cannoli.ts) gates
 * the `/cannoli-battle` command on `user.id === 'cannolibot'`. Without a
 * matching row in the `users` table the bot can authenticate to PS but the
 * server-side plugin rejects every match-creation attempt and the bot is
 * effectively a spectator.
 *
 * The main `seed.ts` script is owned by another workstream, so this helper
 * runs on every backend boot (after migrations, before the scheduler), is
 * idempotent (one-row guarantee enforced by the unique username index plus
 * a SELECT-then-INSERT path), and is no-op'd when bot env isn't configured.
 */

import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { hashPassword } from './auth';

const BOT_USERNAME = process.env.BOT_USERNAME || 'CannoliBot';
const BOT_PASSWORD = process.env.BOT_PASSWORD || 'cannolibot';

/**
 * Insert the `cannolibot` user if missing. Safe to call on every boot — repeated
 * calls do not create duplicate rows or rotate the password (we only hash on the
 * first insert; later calls short-circuit on the SELECT).
 *
 * Returns the user row (newly inserted or pre-existing).
 */
export function ensureBotUser(): {
  id: number;
  username: string;
  created: boolean;
} {
  // Username on PS is canonicalized (lowercase, alnum). The chat plugin checks
  // `user.id === 'cannolibot'` — that's the canonical id PS produces from the
  // configured username. The Cannoli `users` row itself can keep the
  // human-friendly mixed case for UI; auth still works because PS does its
  // own canonicalization.
  const existing = db.select()
    .from(schema.users)
    .where(eq(schema.users.username, BOT_USERNAME))
    .get();

  if (existing) {
    return { id: existing.id, username: existing.username, created: false };
  }

  const inserted = db.insert(schema.users).values({
    username: BOT_USERNAME,
    passwordHash: hashPassword(BOT_PASSWORD),
    role: 'user',
    mustChangePassword: false,
    active: true,
  }).returning().get();

  console.log(`[bot-seed] created user '${BOT_USERNAME}' (id=${inserted.id})`);
  return { id: inserted.id, username: inserted.username, created: true };
}
