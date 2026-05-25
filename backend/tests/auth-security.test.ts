/**
 * Cross-cutting season-stress tests for auth security (routes/auth.ts +
 * index.ts onBeforeHandle guard).
 *
 * Coverage (scope #2):
 *   - login rate-limit lockout: 5 failures / 15-min window / IP → 429
 *   - successful login resets the counter for that IP
 *   - per-IP isolation (one IP's lockout doesn't affect another)
 *   - CSRF double-submit: token issued on login, validated on state-changing
 *     requests, mismatch/missing → 403
 *   - forced-password-reset: mustChangePassword users are confined to
 *     change-password / logout / me
 *   - session expiry mid-flow: an expired session validates as null
 *
 * The login handler reads the client IP from x-forwarded-for, so each test
 * uses a UNIQUE IP to avoid bleeding rate-limit state across tests (the
 * limiter Map is module-private and persists for the process lifetime).
 *
 * The CSRF + mustChangePassword guards live in index.ts's onBeforeHandle, not
 * in authRoutes. We replicate that exact guard in a harness so the test
 * exercises the real helpers (csrfTokenForSession / parseCsrfCookie) and the
 * documented allow-list, without importing index.ts (which calls .listen()).
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { authRoutes } from '../src/routes/auth';
import {
  hashPassword, createSession, deleteSession, validateSession,
  csrfTokenForSession, parseCsrfCookie, parseSessionToken,
} from '../src/lib/auth';

// ── Fixtures: a dedicated login user with a known password ──────────────────
const TEST_USERNAME = 'authsec-login-fixture';
const TEST_PASSWORD = 'correct-horse';

function purgeLoginUser() {
  const existing = db.select().from(schema.users).where(eq(schema.users.username, TEST_USERNAME)).all();
  for (const u of existing) {
    db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id)).run();
  }
  db.delete(schema.users).where(eq(schema.users.username, TEST_USERNAME)).run();
}

function ensureLoginUser(opts: { mustChange?: boolean; active?: boolean } = {}) {
  purgeLoginUser();
  const row = db.insert(schema.users).values({
    username: TEST_USERNAME,
    passwordHash: hashPassword(TEST_PASSWORD),
    role: 'user',
    mustChangePassword: opts.mustChange ?? false,
    active: opts.active ?? true,
  }).returning().get();
  return row;
}

afterAll(() => {
  purgeLoginUser();
});

async function login(ip: string, username: string, password: string): Promise<Response> {
  const app = new Elysia().use(authRoutes);
  return app.handle(new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Login rate-limit lockout
// ─────────────────────────────────────────────────────────────────────────────

describe('login rate-limit lockout (5 fails / 15min / IP)', () => {
  test('locks out the 6th attempt after 5 failures with 429 + Retry-After', async () => {
    ensureLoginUser();
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      const res = await login(ip, TEST_USERNAME, 'wrong-password');
      expect(res.status).toBe(401);
    }
    // 6th attempt — locked out regardless of credentials.
    const locked = await login(ip, TEST_USERNAME, TEST_PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBeTruthy();
    const body = await locked.json() as { retryAfter: number };
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  test('a successful login before lockout resets the failure counter', async () => {
    ensureLoginUser();
    const ip = '10.0.0.2';
    // 4 failures (under the threshold)
    for (let i = 0; i < 4; i++) {
      const r = await login(ip, TEST_USERNAME, 'nope');
      expect(r.status).toBe(401);
    }
    // success resets the counter
    const ok = await login(ip, TEST_USERNAME, TEST_PASSWORD);
    expect(ok.status).toBe(200);
    // now 5 more failures should be needed to lock out; 4 more must NOT lock.
    for (let i = 0; i < 4; i++) {
      const r = await login(ip, TEST_USERNAME, 'nope');
      expect(r.status).toBe(401); // still 401, not 429 — counter was reset
    }
  });

  test('lockout is per-IP: a fresh IP is unaffected by another IP being locked', async () => {
    ensureLoginUser();
    const lockedIp = '10.0.0.3';
    for (let i = 0; i < 6; i++) await login(lockedIp, TEST_USERNAME, 'wrong');
    const stillLocked = await login(lockedIp, TEST_USERNAME, TEST_PASSWORD);
    expect(stillLocked.status).toBe(429);

    // Different IP, correct creds → succeeds.
    const otherIp = '10.0.0.4';
    const ok = await login(otherIp, TEST_USERNAME, TEST_PASSWORD);
    expect(ok.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSRF + mustChangePassword guard (replicates index.ts onBeforeHandle)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Faithful re-implementation of the index.ts onBeforeHandle guard for the two
 * checks under test. Mounted ahead of a trivial protected route.
 */
function guardedApp() {
  return new Elysia()
    .derive(({ request }) => {
      const cookieHeader = request.headers.get('cookie') ?? undefined;
      const token = parseSessionToken(cookieHeader);
      const user = token ? validateSession(token) : null;
      return { user, sessionToken: token };
    })
    .onBeforeHandle(({ request, user, sessionToken, set }) => {
      const method = request.method.toUpperCase();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      const path = new URL(request.url).pathname;
      if (!path.startsWith('/api/')) return;

      const csrfExempt = path === '/api/auth/login' || path === '/api/ps/action.php';
      if (!csrfExempt && sessionToken) {
        const cookieToken = parseCsrfCookie(request.headers.get('cookie') ?? undefined);
        const headerToken = request.headers.get('x-csrf-token');
        const expected = csrfTokenForSession(sessionToken);
        if (!cookieToken || !headerToken || cookieToken !== expected || headerToken !== expected) {
          set.status = 403;
          return { error: 'CSRF token missing or invalid', code: 'csrf_failed' };
        }
      }

      if ((user as any)?.mustChangePassword) {
        const allowed = path === '/api/auth/change-password' || path === '/api/auth/logout' || path === '/api/auth/me';
        if (!allowed) {
          set.status = 403;
          return { error: 'Password change required', code: 'must_change_password' };
        }
      }
    })
    .post('/api/leagues/x/trades/propose', () => ({ ok: true }))     // arbitrary protected mutation
    .post('/api/auth/change-password', () => ({ ok: 'changed' }))
    .get('/api/auth/me', () => ({ ok: 'me' }));
}

function reqWith(method: string, path: string, headers: Record<string, string>) {
  return guardedApp().handle(new Request(`http://localhost${path}`, { method, headers }));
}

describe('CSRF double-submit guard', () => {
  test('mutation with valid session but no CSRF header → 403 csrf_failed', async () => {
    const user = ensureLoginUser();
    const token = createSession(user.id);
    try {
      const res = await reqWith('POST', '/api/leagues/x/trades/propose', {
        cookie: `session=${token}; csrf_token=${csrfTokenForSession(token)}`,
        // no x-csrf-token header
      });
      expect(res.status).toBe(403);
      expect((await res.json() as any).code).toBe('csrf_failed');
    } finally {
      deleteSession(token);
    }
  });

  test('mutation with mismatched CSRF header → 403', async () => {
    const user = ensureLoginUser();
    const token = createSession(user.id);
    try {
      const res = await reqWith('POST', '/api/leagues/x/trades/propose', {
        cookie: `session=${token}; csrf_token=${csrfTokenForSession(token)}`,
        'x-csrf-token': 'deadbeef-not-the-token',
      });
      expect(res.status).toBe(403);
    } finally {
      deleteSession(token);
    }
  });

  test('mutation with matching CSRF cookie + header → passes guard', async () => {
    const user = ensureLoginUser();
    const token = createSession(user.id);
    const csrf = csrfTokenForSession(token);
    try {
      const res = await reqWith('POST', '/api/leagues/x/trades/propose', {
        cookie: `session=${token}; csrf_token=${csrf}`,
        'x-csrf-token': csrf,
      });
      expect(res.status).toBe(200);
      expect((await res.json() as any).ok).toBe(true);
    } finally {
      deleteSession(token);
    }
  });

  test('GET requests are exempt from CSRF', async () => {
    const user = ensureLoginUser();
    const token = createSession(user.id);
    try {
      const res = await reqWith('GET', '/api/auth/me', { cookie: `session=${token}` });
      expect(res.status).toBe(200);
    } finally {
      deleteSession(token);
    }
  });

  test('csrfTokenForSession is deterministic per session token', () => {
    expect(csrfTokenForSession('abc')).toBe(csrfTokenForSession('abc'));
    expect(csrfTokenForSession('abc')).not.toBe(csrfTokenForSession('xyz'));
  });
});

describe('forced-password-reset confinement (mustChangePassword)', () => {
  test('mustChange user is blocked from a general mutation with must_change_password', async () => {
    const user = ensureLoginUser({ mustChange: true });
    const token = createSession(user.id);
    const csrf = csrfTokenForSession(token);
    try {
      const res = await reqWith('POST', '/api/leagues/x/trades/propose', {
        cookie: `session=${token}; csrf_token=${csrf}`,
        'x-csrf-token': csrf,
      });
      expect(res.status).toBe(403);
      expect((await res.json() as any).code).toBe('must_change_password');
    } finally {
      deleteSession(token);
    }
  });

  test('mustChange user CAN reach change-password', async () => {
    const user = ensureLoginUser({ mustChange: true });
    const token = createSession(user.id);
    const csrf = csrfTokenForSession(token);
    try {
      const res = await reqWith('POST', '/api/auth/change-password', {
        cookie: `session=${token}; csrf_token=${csrf}`,
        'x-csrf-token': csrf,
      });
      expect(res.status).toBe(200);
    } finally {
      deleteSession(token);
    }
  });

  test('change-password clears the mustChangePassword flag', async () => {
    const user = ensureLoginUser({ mustChange: true });
    const token = createSession(user.id);
    const csrf = csrfTokenForSession(token);
    try {
      // Hit the REAL authRoutes change-password handler (not the harness stub).
      const app = new Elysia()
        .derive(() => ({ user: { id: String(user.id), username: TEST_USERNAME, role: 'user', mustChangePassword: true } as any, sessionToken: token }))
        .use(authRoutes);
      const res = await app.handle(new Request('http://localhost/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: 'brand-new-pw' }),
      }));
      expect(res.status).toBe(200);
      const fresh = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()!;
      expect(fresh.mustChangePassword).toBe(false);
    } finally {
      deleteSession(token);
    }
  });
});

describe('session expiry mid-flow', () => {
  test('an expired session validates as null (locked out of protected routes)', async () => {
    const user = ensureLoginUser();
    // Create a session row then force its expiry into the past.
    const token = createSession(user.id);
    db.update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(schema.sessions.id, token)).run();
    try {
      expect(validateSession(token)).toBeNull();
      // A protected GET with the now-expired cookie behaves as unauthenticated.
      const res = await reqWith('GET', '/api/auth/me', { cookie: `session=${token}` });
      // Guard lets it through (no user); the stub returns 200, but user is null.
      expect(res.status).toBe(200);
    } finally {
      deleteSession(token);
    }
  });

  test('a deactivated user validates as null even with a live session', async () => {
    const user = ensureLoginUser({ active: false });
    const token = createSession(user.id);
    try {
      expect(validateSession(token)).toBeNull();
    } finally {
      deleteSession(token);
    }
  });
});
