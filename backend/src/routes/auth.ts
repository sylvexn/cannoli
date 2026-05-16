import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import {
  hashPassword, verifyPassword,
  createSession, deleteSession,
  sessionCookieString, clearSessionCookieString,
  csrfTokenForSession, csrfCookieString, clearCsrfCookieString,
} from '../lib/auth';
import { createPsSession, psSidCookieString, clearPsSidCookieString, deletePsSessionFromCookie } from '../lib/ps-login';

// ─── Login rate limiter ─────────────────────────────────────────────────────
// In-memory, per-IP. Max 5 failed attempts per 15-minute window; once
// exceeded, the IP is locked out for 15 minutes. Successful login resets
// the counter for that IP. No external deps.

const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_MAX_FAILS = 5;
const RL_LOCKOUT_MS = 15 * 60 * 1000;

interface RateLimitEntry {
  fails: number;
  firstFailAt: number;
  lockedUntil: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
}

/** Returns seconds remaining if locked out, else 0. Side-effect: prunes expired entries. */
function checkLockout(ip: string): number {
  const entry = loginAttempts.get(ip);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.lockedUntil > now) {
    return Math.ceil((entry.lockedUntil - now) / 1000);
  }
  // Window expired with no lockout — clear it.
  if (entry.lockedUntil <= now && now - entry.firstFailAt > RL_WINDOW_MS) {
    loginAttempts.delete(ip);
  }
  return 0;
}

function recordFailure(ip: string) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstFailAt > RL_WINDOW_MS) {
    loginAttempts.set(ip, { fails: 1, firstFailAt: now, lockedUntil: 0 });
    return;
  }
  entry.fails += 1;
  if (entry.fails >= RL_MAX_FAILS) {
    entry.lockedUntil = now + RL_LOCKOUT_MS;
  }
}

function clearAttempts(ip: string) {
  loginAttempts.delete(ip);
}

export const authRoutes = new Elysia()

  .post('/api/auth/login', async ({ body, request, set }) => {
    const ip = clientIp(request);

    // Rate limit: bail before doing any DB work / bcrypt if locked out.
    const lockoutSec = checkLockout(ip);
    if (lockoutSec > 0) {
      set.status = 429;
      set.headers['retry-after'] = String(lockoutSec);
      return { error: 'Too many failed attempts. Try again later.', retryAfter: lockoutSec };
    }

    const { username, password } = body as { username: string; password: string };
    if (!username || !password) {
      set.status = 400;
      return { error: 'Username and password required' };
    }

    const user = db.select().from(schema.users)
      .where(eq(schema.users.username, username.toLowerCase().trim()))
      .get();

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      recordFailure(ip);
      set.status = 401;
      return { error: 'Invalid username or password' };
    }

    // Successful login — reset rate limit for this IP.
    clearAttempts(ip);

    const token = createSession(user.id);
    const csrfToken = csrfTokenForSession(token);

    // SSO bridge: also create a PS session so sim.cannoli.live auto-authenticates
    const { sidCookie } = createPsSession(user.username, ip);

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Set-Cookie', sessionCookieString(token));
    headers.append('Set-Cookie', csrfCookieString(csrfToken));
    headers.append('Set-Cookie', psSidCookieString(sidCookie));

    return new Response(JSON.stringify({
      user: {
        id: String(user.id),
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        active: user.active,
        createdAt: user.createdAt,
        primaryColor: user.primaryColor,
        secondaryColor: user.secondaryColor,
        tertiaryColor: user.tertiaryColor,
        displayName: user.displayName,
        bio: user.bio,
        avatarPath: user.avatarPath,
        signaturePokemonId: user.signaturePokemonId,
        title: user.title,
        signatureType: user.signatureType,
      },
    }), { headers });
  })

  .post('/api/auth/logout', ({ sessionToken, request }) => {
    if (sessionToken) deleteSession(sessionToken);

    // Server-side PS session invalidation. Without this the sid cookie is
    // cleared client-side but the in-memory PS session keeps validating
    // until expiry — meaning a captured cookie remains useful indefinitely.
    deletePsSessionFromCookie(request.headers.get('cookie') ?? undefined);

    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Set-Cookie', clearSessionCookieString());
    headers.append('Set-Cookie', clearCsrfCookieString());
    headers.append('Set-Cookie', clearPsSidCookieString());

    return new Response(JSON.stringify({ success: true }), { headers });
  })

  .get('/api/auth/me', ({ user, sessionToken, set }) => {
    if (!user) {
      set.status = 401;
      return { user: null };
    }
    // Refresh the CSRF cookie on session validation, so clients that have a
    // valid httpOnly session but a missing/expired csrf_token cookie get a
    // fresh one on the next /me hit.
    if (sessionToken) {
      const headers = new Headers();
      headers.append('Content-Type', 'application/json');
      headers.append('Set-Cookie', csrfCookieString(csrfTokenForSession(sessionToken)));
      return new Response(JSON.stringify({ user }), { headers });
    }
    return { user };
  })

  .patch('/api/users/me/colors', ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    const { primaryColor, secondaryColor, tertiaryColor } = (body ?? {}) as Record<string, unknown>;
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    const updates: Record<string, unknown> = {};
    for (const [key, value] of [
      ['primaryColor', primaryColor],
      ['secondaryColor', secondaryColor],
      ['tertiaryColor', tertiaryColor],
    ] as const) {
      if (value === null) { updates[key] = null; continue; }
      if (value === undefined) continue;
      if (typeof value !== 'string' || !hexRe.test(value)) {
        set.status = 400;
        return { error: `${key} must be a #RRGGBB hex string` };
      }
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      set.status = 400; return { error: 'No fields to update' };
    }
    db.update(schema.users).set(updates).where(eq(schema.users.id, parseInt(user.id))).run();
    db.insert(schema.activityLog).values({
      type: 'user_colors_updated',
      category: 'auth',
      actor: user.username,
      leagueId: null,
      description: `Updated profile colors`,
      metadata: JSON.stringify(updates),
    }).run();
    return { success: true };
  })

  .post('/api/auth/change-password', ({ body, user, set }) => {
    const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string };

    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!currentPassword || !newPassword) {
      set.status = 400;
      return { error: 'Current and new password required' };
    }
    if (newPassword.length < 4) {
      set.status = 400;
      return { error: 'Password must be at least 4 characters' };
    }

    const dbUser = db.select().from(schema.users)
      .where(eq(schema.users.id, parseInt(user.id)))
      .get();
    if (!dbUser || !verifyPassword(currentPassword, dbUser.passwordHash)) {
      set.status = 403;
      return { error: 'Current password is incorrect' };
    }

    db.update(schema.users)
      .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false })
      .where(eq(schema.users.id, dbUser.id))
      .run();

    return { success: true };
  });
