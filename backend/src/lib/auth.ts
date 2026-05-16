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
    role: user.role as 'dev' | 'admin' | 'user',
    mustChangePassword: user.mustChangePassword,
    active: user.active,
    createdAt: user.createdAt,
    primaryColor: user.primaryColor,
    secondaryColor: user.secondaryColor,
    tertiaryColor: user.tertiaryColor,
    displayName: user.displayName,
    bio: user.bio,
    avatarPath: user.avatarPath,
    // Coach flair (signaturePokemonId + title + signatureType). Surface
    // pass fields (statusMessage, bannerUrl, lastSeenAt) flow through the
    // same shape but are populated by their own pipeline.
    signaturePokemonId: user.signaturePokemonId,
    title: user.title,
    signatureType: user.signatureType,
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

const CSRF_SECRET = process.env.CANNOLI_CSRF_SECRET
  || process.env.CANNOLI_SESSION_SECRET
  || 'cannoli-dev-csrf-secret-change-in-prod';

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
