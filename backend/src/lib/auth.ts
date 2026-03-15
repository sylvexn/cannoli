/**
 * Auth helpers: password hashing, session management, cookie utilities.
 */

import { compareSync, hashSync } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { db, schema } from '../db';
import { eq, and, gt } from 'drizzle-orm';

// ─── Password ───────────────────────────────────────────────────────────────

export function hashPassword(plain: string): string {
  return hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return compareSync(plain, hash);
}

// ─── Sessions ───────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createSession(userId: number): string {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.insert(schema.sessions).values({ id: token, userId, expiresAt }).run();
  return token;
}

export function validateSession(token: string) {
  const session = db.select().from(schema.sessions)
    .where(and(
      eq(schema.sessions.id, token),
      gt(schema.sessions.expiresAt, new Date().toISOString()),
    ))
    .get();
  if (!session) return null;

  const user = db.select().from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .get();
  if (!user || !user.active) return null;

  return {
    id: String(user.id),
    username: user.username,
    role: user.role as 'dev' | 'admin' | 'user',
    mustChangePassword: user.mustChangePassword,
    active: user.active,
    createdAt: user.createdAt,
    primaryColor: user.primaryColor,
    secondaryColor: user.secondaryColor,
    tertiaryColor: user.tertiaryColor,
  };
}

export function deleteSession(token: string) {
  db.delete(schema.sessions).where(eq(schema.sessions.id, token)).run();
}

// ─── Cookies ────────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_DOMAIN = IS_PROD ? '.cannoli.live' : undefined;

export function sessionCookieString(token: string): string {
  const parts = [
    `session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_MS / 1000}`,
  ];
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`);
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookieString(): string {
  const parts = [
    'session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`);
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

/** Check if a user has staff privileges (dev or admin — both have full override power) */
export function isStaff(user: { role: string } | null | undefined): boolean {
  return !!user && (user.role === 'dev' || user.role === 'admin');
}

export function parseSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}
