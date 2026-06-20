/**
 * Auth helpers: password hashing, session management, cookie utilities.
 */

import { compareSync, hashSync } from 'bcryptjs';
import { randomUUID, createHmac } from 'crypto';
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
    role: user.role as 'dev' | 'admin' | 'user' | 'bot',
    mustChangePassword: user.mustChangePassword,
    active: user.active,
    createdAt: user.createdAt,
    primaryColor: user.primaryColor,
    secondaryColor: user.secondaryColor,
    tertiaryColor: user.tertiaryColor,
    displayName: user.displayName,
    bio: user.bio,
    avatarPath: user.avatarPath,
    psUsername: user.psUsername,
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

/** Check if a user has staff privileges (dev, admin, or bot — all have full
 *  override power). `bot` is the automation account role (root + CannoliBot);
 *  it shares staff power but is kept out of the admin/"elite 4" filter in the UI. */
export function isStaff(user: { role: string } | null | undefined): boolean {
  return !!user && (user.role === 'dev' || user.role === 'admin' || user.role === 'bot');
}

/** True only for the `dev` role — for tooling that admins shouldn't see
 *  (raw API logs, feedback triage). Stricter than isStaff. */
export function isDev(user: { role: string } | null | undefined): boolean {
  return !!user && user.role === 'dev';
}

/** True if user is staff or owns the given team (teams.userId === user.id). */
export function isStaffOrTeamOwner(
  user: { id: string; role: string } | null | undefined,
  teamId: string,
): boolean {
  if (!user) return false;
  if (isStaff(user)) return true;
  const team = db.select({ userId: schema.teams.userId })
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .get();
  return !!team && team.userId === parseInt(user.id);
}

export function parseSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

// ─── CSRF (double-submit token tied to session) ─────────────────────────────
// Token is derived deterministically from the session token via HMAC, so we
// don't need a DB column. Anyone holding the cookie can compute it; the point
// is that a cross-site attacker cannot read the cookie value (httpOnly
// session is unreadable, and we don't accept CORS credentialed requests from
// untrusted origins) so they can't echo it back in the X-CSRF-Token header.

const CSRF_DEV_FALLBACK = 'cannoli-dev-csrf-secret-change-in-prod';
const CSRF_SECRET = process.env.CANNOLI_CSRF_SECRET
  || process.env.CANNOLI_SESSION_SECRET
  || CSRF_DEV_FALLBACK;

// Fail-closed in production: if neither secret env var is set the HMAC key is
// the public fallback constant, making every token forgeable.  Throw at
// module-load time so the process refuses to start rather than silently
// serving a broken security model.
{
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.CANNOLI_MODE === 'live';
  const usingFallback =
    !process.env.CANNOLI_CSRF_SECRET && !process.env.CANNOLI_SESSION_SECRET;
  if (isProduction && usingFallback) {
    throw new Error(
      'FATAL: CANNOLI_CSRF_SECRET (or CANNOLI_SESSION_SECRET) must be set in production. ' +
      'Refusing to start with the public default CSRF secret.',
    );
  }
}

export function csrfTokenForSession(sessionToken: string): string {
  return createHmac('sha256', CSRF_SECRET).update(sessionToken).digest('hex');
}

export function csrfCookieString(token: string): string {
  // httpOnly: false so the frontend JS can read it and echo into the header.
  const parts = [
    `csrf_token=${token}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_MS / 1000}`,
  ];
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`);
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

export function clearCsrfCookieString(): string {
  const parts = [
    'csrf_token=',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`);
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

export function parseCsrfCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? match[1] : null;
}
