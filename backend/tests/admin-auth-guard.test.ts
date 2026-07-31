/**
 * AUTH-GUARD regression (launch-prep P0).
 *
 * ~80 admin handlers used to hand-copy `if (!isStaff(user)) { 403 }`. One
 * omitted line silently exposed an unauthenticated mutation endpoint. The fix
 * adds a group-level `.guard({ beforeHandle: requireStaff })` on the pure-staff
 * admin sub-routers (config, leagues, seasons, templates, users, misc), so the
 * staff check is structural — present even on routes that forget to check.
 *
 * This test mounts the real `adminRoutes` behind a `.derive` that resolves
 * `user` from a session cookie exactly like the production root app, then
 * hits a sampling of admin mutation routes:
 *   - unauthenticated  → 401
 *   - authed non-staff → 403
 *   - authed staff     → NOT 401/403 (passes the guard; may 400/404/409 on body)
 *
 * Routes that intentionally allow non-staff (team-owner routes in teams.ts,
 * the public /uploads file route) are NOT part of the guarded groups and are
 * deliberately excluded here.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { adminRoutes } from '../src/routes/admin';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

// Mirror the production root app's auth derivation so handlers see `user`.
function buildApp() {
  return new Elysia()
    .derive(({ request }) => {
      const cookieHeader = request.headers.get('cookie') ?? undefined;
      const token = parseSessionToken(cookieHeader);
      const user = token ? validateSession(token) : null;
      return { user, sessionToken: token };
    })
    .use(adminRoutes);
}

let app: Elysia;
const tag = `authguard-${Date.now()}`;
const userIds: number[] = [];
let staffSession: string;
let userSession: string;
let devSession: string;

function mkUser(name: string, role: 'dev' | 'admin' | 'user'): string {
  const u = db.insert(schema.users).values({
    username: `${tag}-${name}`, passwordHash: 'x', role, mustChangePassword: false, active: true,
  }).returning().get();
  userIds.push(u.id);
  return createSession(u.id);
}

beforeAll(() => {
  app = buildApp();
  staffSession = mkUser('staff', 'admin');
  userSession = mkUser('coach', 'user');
  devSession = mkUser('dev', 'dev');
});

afterAll(() => {
  try {
    for (const id of userIds) {
      db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
      db.delete(schema.users).where(eq(schema.users.id, id)).run();
    }
  } catch { /* DB closed during suite teardown */ }
});

function hit(method: string, path: string, cookie?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.handle(new Request(`http://localhost${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
}

// A representative sampling across the guarded sub-routers. Each is a mutation
// (or staff-only read) that must never run for a non-staff caller.
const SAMPLES: { method: string; path: string; body?: unknown }[] = [
  { method: 'PUT', path: '/api/site-settings', body: {} },                      // config
  { method: 'POST', path: '/api/move-categories', body: { name: 'X' } },        // config
  { method: 'POST', path: '/api/leagues', body: {} },                           // leagues
  { method: 'POST', path: `/api/leagues/${tag}-nope/week`, body: {} },          // leagues
  { method: 'POST', path: '/api/seasons', body: {} },                           // seasons
  { method: 'POST', path: '/api/draft-templates', body: {} },                   // templates
  { method: 'GET', path: '/api/draft-templates' },                              // templates (staff read)
  { method: 'POST', path: '/api/users', body: {} },                             // users
  { method: 'GET', path: '/api/users' },                                        // users (staff read)
  { method: 'GET', path: '/api/admin/notifications/log' },                      // notifications (staff read)
  { method: 'GET', path: '/api/activity-log' },                                 // misc (staff read)
];

// Routes narrowed to dev-only (per-route requireDev below the group's
// requireStaff) — an admin must be BLOCKED (403), only a dev may pass.
const DEV_ONLY: { method: string; path: string; body?: unknown }[] = [
  { method: 'GET', path: '/api/admin/bot-status' },                             // misc — PS bot tooling
  { method: 'POST', path: '/api/admin/bot/reconnect' },                         // misc — PS bot tooling
];

describe('admin auth guard — unauthenticated', () => {
  for (const s of SAMPLES) {
    test(`${s.method} ${s.path} → 401`, async () => {
      const res = await hit(s.method, s.path, undefined, s.body);
      expect(res.status).toBe(401);
    });
  }
});

describe('admin auth guard — authed non-staff', () => {
  for (const s of SAMPLES) {
    test(`${s.method} ${s.path} → 403`, async () => {
      const res = await hit(s.method, s.path, `session=${userSession}`, s.body);
      expect(res.status).toBe(403);
    });
  }
});

describe('admin auth guard — staff passes the guard', () => {
  // For a staff caller the guard must NOT short-circuit. The handler may still
  // 400/404/409 on an empty/invalid body, but it must never be 401/403.
  for (const s of SAMPLES) {
    test(`${s.method} ${s.path} is reachable (not 401/403)`, async () => {
      const res = await hit(s.method, s.path, `session=${staffSession}`, s.body);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  }
});

describe('admin auth guard — dev-only routes', () => {
  // These sit behind the group's requireStaff AND a per-route requireDev, so an
  // admin (staff but not dev) must be blocked; only a dev passes the guard.
  for (const s of DEV_ONLY) {
    test(`${s.method} ${s.path} → 401 unauthenticated`, async () => {
      expect((await hit(s.method, s.path, undefined, s.body)).status).toBe(401);
    });
    test(`${s.method} ${s.path} → 403 for non-staff`, async () => {
      expect((await hit(s.method, s.path, `session=${userSession}`, s.body)).status).toBe(403);
    });
    test(`${s.method} ${s.path} → 403 for admin (narrowed to dev)`, async () => {
      expect((await hit(s.method, s.path, `session=${staffSession}`, s.body)).status).toBe(403);
    });
    test(`${s.method} ${s.path} is reachable for dev (not 401/403)`, async () => {
      const res = await hit(s.method, s.path, `session=${devSession}`, s.body);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  }
});

// Role escalation whitelist
// PUT /api/users/:id is the only endpoint that can change a user's role.
// An admin must NOT be able to set role='dev' (platform-highest tier) via this
// endpoint — the whitelist allows only 'user' and 'admin'.

describe('admin user PUT — role escalation prevention', () => {
  let targetUserId: number;

  beforeAll(() => {
    // Create a plain user to be the target of escalation attempts.
    const u = db.insert(schema.users).values({
      username: `${tag}-target`, passwordHash: 'x', role: 'user',
      mustChangePassword: false, active: true,
    }).returning().get();
    userIds.push(u.id);
    targetUserId = u.id;
  });

  test('admin cannot set role to dev (→ 400)', async () => {
    const res = await hit(
      'PUT', `/api/users/${targetUserId}`,
      `session=${staffSession}`,
      { role: 'dev' },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/dev/i);
  });

  test('admin cannot set role to bot (→ 400)', async () => {
    const res = await hit(
      'PUT', `/api/users/${targetUserId}`,
      `session=${staffSession}`,
      { role: 'bot' },
    );
    expect(res.status).toBe(400);
  });

  test('admin CAN set role to user (→ not 400/401/403)', async () => {
    const res = await hit(
      'PUT', `/api/users/${targetUserId}`,
      `session=${staffSession}`,
      { role: 'user' },
    );
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('admin CAN set role to admin (→ not 400/401/403)', async () => {
    const res = await hit(
      'PUT', `/api/users/${targetUserId}`,
      `session=${staffSession}`,
      { role: 'admin' },
    );
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('role is unchanged in DB after a rejected dev-escalation attempt', async () => {
    // Reset target to 'user' first so we have a clean baseline.
    await hit('PUT', `/api/users/${targetUserId}`, `session=${staffSession}`, { role: 'user' });

    await hit('PUT', `/api/users/${targetUserId}`, `session=${staffSession}`, { role: 'dev' });

    const row = db.select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId))
      .get();
    expect(row?.role).toBe('user');
  });
});
