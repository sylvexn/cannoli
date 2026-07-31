/**
 * Pokemon Showdown login server protocol implementation.
 *
 * Implements the PS login protocol so our Elysia backend can act as the
 * login server for a private PS game server. No fork of the official
 * login server needed.
 *
 * Protocol:
 *   1. Client connects to PS game server, receives |challstr|CHALLENGE
 *   2. Client POSTs to /api/ps/login with name, pass, challstr
 *   3. We validate credentials, return RSA-signed assertion
 *   4. Client sends /trn USERNAME,0,ASSERTION to game server
 *   5. Game server verifies RSA signature with our public key
 *
 * Assertion format:
 *   "{challstr},{userid},{usertype},{timestamp},{hostname};{RSA-SHA1-signature}"
 */

import { createSign } from 'crypto';
import { db, schema } from '../db';
import { eq, and, gt } from 'drizzle-orm';
import { verifyPassword } from './auth';
import { hashSync, compareSync } from 'bcryptjs';
import { randomBytes } from 'crypto';

const CANNOLI_MODE = process.env.CANNOLI_MODE || 'mock';

// Config

const PS_HOSTNAME = process.env.PS_HOSTNAME || 'cannoli.live';
const PS_KEY_ID = parseInt(process.env.PS_KEY_ID || '4', 10);

// RSA private key — loaded from env. PEM format.
let rsaPrivateKey: string | null = null;

export function getPrivateKey(): string | null {
  if (rsaPrivateKey) return rsaPrivateKey;
  const envKey = process.env.PS_RSA_PRIVATE_KEY;
  if (envKey) {
    // Support both raw PEM and escaped newlines from env
    rsaPrivateKey = envKey.replace(/\\n/g, '\n');
    return rsaPrivateKey;
  }
  return null;
}

export function getKeyId(): number {
  return PS_KEY_ID;
}

// PS Session Management
//
// PS uses its own `sid` cookie separate from our app session cookie.
// Format: "username,sessionId,sidhash"
// We store these in a lightweight in-memory map (ephemeral — survives restarts
// via re-login, which is fine for a private server).

interface PsSession {
  userid: string;
  sidHash: string; // bcrypt hash of the random sid component
  createdAt: number; // unix seconds
  ip: string;
}

const psSessions = new Map</* sessionId */ string, PsSession>();
let nextSessionId = 1;

const PS_SESSION_TTL = 363 * 24 * 60 * 60; // ~1 year in seconds (matches PS default)
const PS_COOKIE_DOMAIN = process.env.NODE_ENV === 'production' ? '.cannoli.live' : undefined;

// Periodic sweep: prune expired PS sessions from the in-memory map so that
// idle/abandoned sessions don't accumulate indefinitely (slow memory-exhaustion
// vector — each entry is ~200 bytes including the bcrypt hash string, but
// unbounded growth is the risk over months of uptime).
//
// Runs every 6 hours — aggressive enough to bound max resident entries to
// ~(creation rate × 6h) above the TTL-based floor, cheap enough to be noise.
// `.unref()` so the interval never prevents the process from exiting cleanly
// and never keeps the Bun test runner alive after tests complete.
{
  const sweepInterval = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, session] of psSessions) {
      if (now - session.createdAt > PS_SESSION_TTL) {
        psSessions.delete(id);
      }
    }
  }, 6 * 60 * 60 * 1000); // 6 hours
  sweepInterval.unref();
}

/**
 * Create a PS session and return the sid cookie value.
 */
export function createPsSession(username: string, ip: string): { sidCookie: string; sessionId: string } {
  const userid = toUserid(username);
  const sessionId = String(nextSessionId++);
  const sidRandom = randomBytes(24).toString('hex');
  const sidHash = hashSync(sidRandom, 4); // light bcrypt, just for session validation

  psSessions.set(sessionId, {
    userid,
    sidHash,
    createdAt: Math.floor(Date.now() / 1000),
    ip,
  });

  const sidCookie = `${username},${sessionId},${sidRandom}`;
  return { sidCookie, sessionId };
}

/**
 * Validate a PS sid cookie. Returns the userid if valid, null otherwise.
 */
export function validatePsSid(sidCookieValue: string): string | null {
  if (!sidCookieValue) return null;

  const parts = sidCookieValue.split(',');
  if (parts.length < 3) return null;

  const [, sessionId, sidRandom] = parts;
  const session = psSessions.get(sessionId);
  if (!session) return null;

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (now - session.createdAt > PS_SESSION_TTL) {
    psSessions.delete(sessionId);
    return null;
  }

  // Validate hash
  if (!compareSync(sidRandom, session.sidHash)) return null;

  return session.userid;
}

/**
 * Destroy a PS session by sid cookie value.
 */
export function destroyPsSession(sidCookieValue: string) {
  if (!sidCookieValue) return;
  const parts = sidCookieValue.split(',');
  if (parts.length >= 2) {
    psSessions.delete(parts[1]);
  }
}

/**
 * Delete a PS session given the raw Cookie header (server-side invalidation
 * on logout). Mirrors `deleteSession` for the app session — without this, the
 * sid stays valid in our in-memory map until expiry, so a stolen cookie keeps
 * authenticating to sim.cannoli.live even after the user logs out of the
 * main app.
 */
export function deletePsSessionFromCookie(cookieHeader: string | undefined) {
  const sid = parsePsSid(cookieHeader);
  if (sid) destroyPsSession(sid);
}

/**
 * Build the Set-Cookie header for the PS sid.
 *
 * The sid value contains commas (`username,sessionId,sidRandom`), which are
 * not valid cookie-octets per RFC 6265. Modern Chrome silently drops cookies
 * whose value contains a raw comma. URL-encode commas (%2C) so the cookie
 * survives — matching the official PS client's expectation (it decodes %2C
 * back to comma before parsing).
 */
export function psSidCookieString(sidCookie: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const encoded = sidCookie.replace(/,/g, '%2C');
  const parts = [
    `sid=${encoded}`,
    'Path=/',
    `Max-Age=${PS_SESSION_TTL}`,
    // Prod: SameSite=None + Secure (cross-subdomain .cannoli.live via HTTPS)
    // Dev: SameSite=Lax (same-origin via ps-client-server proxy, no HTTPS)
    isProd ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (PS_COOKIE_DOMAIN) parts.push(`Domain=${PS_COOKIE_DOMAIN}`);
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

export function clearPsSidCookieString(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    'sid=',
    'Path=/',
    'Max-Age=0',
    isProd ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (PS_COOKIE_DOMAIN) parts.push(`Domain=${PS_COOKIE_DOMAIN}`);
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

// Assertion Signing

/**
 * Resolve Cannoli role + league memberships for the assertion's optional
 * trailing fields (s1/s2/s3, see PS users.ts:706). PS stores these on
 * `user.s1/s2/s3` after a successful login and exposes them to chat plugins,
 * so this is how we ferry "who is this person in Cannoli" across the SSO.
 *
 *   s1 = compact role:   'admin' | 'coach' | 'user'
 *        (collapses Cannoli `dev` → `admin`; PS never sees `guest`)
 *   s2 = comma-separated league slugs the user is a coach (team owner) in
 *        (empty string if none)
 *   s3 = reserved (empty for now — keeps the slot for future expansion)
 *
 * Returns null when the user isn't found in Cannoli's DB (e.g. PS sent us a
 * userid we've never authenticated, which shouldn't happen post-login). The
 * signer falls back to empty s-fields in that case.
 */
export function getAssertionExtras(userid: string): { s1: string; s2: string; s3: string } | null {
  // We were handed a PS userid (lowercased, alnum-only). Match Cannoli usernames
  // the same way `authenticateUser` does — exact-match on the normalised form.
  let user = db.select().from(schema.users)
    .where(eq(schema.users.username, userid))
    .get();
  if (!user) {
    const allUsers = db.select().from(schema.users).all();
    user = allUsers.find(u => toUserid(u.username) === userid) ?? null;
  }
  if (!user) return null;

  const role: 'admin' | 'coach' | 'user' = user.role === 'dev' || user.role === 'admin'
    ? 'admin'
    : 'user'; // baseline — overridden to 'coach' below if they own at least one team

  // Coach memberships: any team rows whose userId points at this user, scoped
  // to leagues that are still in an active phase (skip archived/offseason runs).
  const teamRows = db.select({
    leagueId: schema.teams.leagueId,
    phase: schema.leagues.phase,
  })
    .from(schema.teams)
    .innerJoin(schema.leagues, eq(schema.leagues.id, schema.teams.leagueId))
    .where(eq(schema.teams.userId, user.id))
    .all();

  const activePhases = new Set(['predraft', 'draft', 'regular', 'playoffs']);
  const slugs = teamRows
    .filter(r => activePhases.has(r.phase))
    .map(r => r.leagueId);

  const finalRole = role === 'admin' ? 'admin' : (slugs.length > 0 ? 'coach' : 'user');

  return {
    s1: finalRole,
    s2: slugs.join(','),
    s3: '',
  };
}

/**
 * Generate a signed assertion for the PS game server.
 *
 * @param challstr - The challenge string from |challstr| (contains a pipe)
 * @param userid - Normalized (lowercased, no special chars) username
 * @param userType - '2' for registered users (our only type)
 *
 * The assertion's tokenData carries optional trailing fields s1/s2/s3
 * (see `getAssertionExtras`). Adding them is backward-compatible: PS only
 * reads `tokenDataSplit[5..7]` after RSA verification, so older PS builds
 * that ignore them still verify the same data block.
 */
export function signAssertion(challstr: string, userid: string, userType: string = '2'): string | null {
  const privateKey = getPrivateKey();
  if (!privateKey) return null;

  // challstr from PS client is "keyid|challenge" (e.g. "4|abc123hex...")
  // The game server stores only the challenge part (no keyid prefix).
  // The assertion must use the raw challenge, not the full challstr.
  const pipeIndex = challstr.indexOf('|');
  const challenge = pipeIndex >= 0 ? challstr.slice(pipeIndex + 1) : challstr;

  const timestamp = Math.floor(Date.now() / 1000);
  const extras = getAssertionExtras(userid) ?? { s1: '', s2: '', s3: '' };
  const tokenData = `${challenge},${userid},${userType},${timestamp},${PS_HOSTNAME},${extras.s1},${extras.s2},${extras.s3}`;

  try {
    const sign = createSign('RSA-SHA1');
    sign.update(tokenData);
    const signature = sign.sign(privateKey, 'hex');
    return `${tokenData};${signature}`;
  } catch (err) {
    console.error('[PS Login] Failed to sign assertion:', err);
    return null;
  }
}

// User Lookup

/**
 * Normalize a username to a userid (PS convention: lowercase, strip non-alnum).
 */
export function toUserid(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Derive the effective PS userid for a Cannoli user row.
 *
 * When a user has set a custom `psUsername`, that takes precedence so their
 * chosen name (e.g. PPG, SSS, EGD) appears in Showdown battles and chat.
 * Otherwise we fall back to the Cannoli `username` — the existing behaviour.
 */
export function getPsUserid(user: { username: string; psUsername?: string | null }): string {
  return toUserid(user.psUsername ?? user.username);
}

/**
 * Look up a user and verify password. Returns the user row or null.
 *
 * Mock mode: if the user doesn't exist in Cannoli's `users` table, auto-create
 * them on first PS login. The Cannoli backend is the PS server's login server
 * (PS runs with `--no-security`, so PS itself has no separate user store to
 * keep in sync) — every PS auth check resolves through `authenticateUser`.
 * Without this, anyone whose coach name wasn't covered by the XLSX import gets
 * a hard 401 the moment the PS client posts to `/api/ps/login`, which makes
 * casual mock testing painful. Live mode keeps the strict lookup.
 */
export function authenticateUser(name: string, password: string) {
  const userid = toUserid(name);

  // PS uses userid for lookup, we use username (which is already lowercased in our DB)
  // Try exact match first, then userid match
  let user = db.select().from(schema.users)
    .where(eq(schema.users.username, userid))
    .get();

  if (!user) {
    // Try matching by stripping the username the same way
    const allUsers = db.select().from(schema.users).all();
    user = allUsers.find(u => toUserid(u.username) === userid) ?? null;
  }

  if (!user) {
    if (CANNOLI_MODE !== 'mock') return null;
    return autoCreateMockUser(userid, password);
  }

  if (!user.active) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  return user;
}

/**
 * Mock-only: create a fresh Cannoli user account on first PS login.
 * Username is the PS-normalized userid (lowercased, alnum-only) so the
 * follow-up assertion-signing path lines up with what PS will see.
 */
function autoCreateMockUser(userid: string, password: string) {
  if (!userid || !password) return null;
  // Sanity-check: don't auto-create reserved names
  if (userid === 'root' || userid === 'syl' || userid === 'cannolibot') return null;

  const passwordHash = hashSync(password, 10);
  const inserted = db.insert(schema.users).values({
    username: userid,
    passwordHash,
    role: 'user',
    mustChangePassword: false,
    active: true,
  }).returning().get();

  console.log(`[PS Login] auto-created mock user "${userid}" on first login`);
  return inserted;
}

// Parse PS sid from cookie header

export function parsePsSid(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!match) return null;
  // Cookie value was URL-encoded (commas → %2C) when set; decode for parsing.
  return decodeURIComponent(match[1]);
}
