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

// ─── Config ─────────────────────────────────────────────────────────────────

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

// ─── PS Session Management ──────────────────────────────────────────────────
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
 * Destroy a PS session.
 */
export function destroyPsSession(sidCookieValue: string) {
  if (!sidCookieValue) return;
  const parts = sidCookieValue.split(',');
  if (parts.length >= 2) {
    psSessions.delete(parts[1]);
  }
}

/**
 * Build the Set-Cookie header for the PS sid.
 */
export function psSidCookieString(sidCookie: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `sid=${sidCookie}`,
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

// ─── Assertion Signing ──────────────────────────────────────────────────────

/**
 * Generate a signed assertion for the PS game server.
 *
 * @param challstr - The challenge string from |challstr| (contains a pipe)
 * @param userid - Normalized (lowercased, no special chars) username
 * @param userType - '2' for registered users (our only type)
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
  const tokenData = `${challenge},${userid},${userType},${timestamp},${PS_HOSTNAME}`;

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

// ─── User Lookup ────────────────────────────────────────────────────────────

/**
 * Normalize a username to a userid (PS convention: lowercase, strip non-alnum).
 */
export function toUserid(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Look up a user and verify password. Returns the user row or null.
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

  if (!user || !user.active) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  return user;
}

// ─── Parse PS sid from cookie header ────────────────────────────────────────

export function parsePsSid(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
  return match ? match[1] : null;
}
