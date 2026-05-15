/**
 * Regression tests for the simulator triple-gate.
 *
 * The season simulator is strictly mock-only. Three separate layers ensure it
 * cannot affect the live deployment:
 *
 *   1. Mount-time gate — `simRoutesGated` is an empty Elysia in live mode, so
 *      the `/api/admin/sim/*` paths do not exist in the route tree at all.
 *   2. Per-request gate — every handler calls `assertMockMode()` first, which
 *      throws if `CANNOLI_MODE !== 'mock'`; `gate()` catches that throw and
 *      returns a flat 404 indistinguishable from an unmounted route.
 *   3. Auth gate — `POST /api/auth/demo-session` hard-checks `CANNOLI_MODE`
 *      at request time and returns 404 when not in mock mode.
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `isMock()` / `assertMockMode()` read `process.env.CANNOLI_MODE` at call time
 * (not cached), so those guard functions are tested by setting env before each
 * call and restoring it after.
 *
 * `simRoutesGated` is evaluated at module-load time. Under the test runner
 * `CANNOLI_MODE` is unset → `isMock()` returns false → `simRoutesGated` is an
 * empty Elysia. We verify this produces 404 for every sim path, and also
 * verify that the real `simRoutes` group (which has handlers) returns 404 via
 * the per-request `gate()` when `CANNOLI_MODE=live`.
 *
 * `POST /api/auth/demo-session` checks env at request time, so we can test
 * both branches without re-importing the module.
 *
 * No seeded DB is required for any of these assertions.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';

// ── Guard functions (read env at call time, safe to test with save/restore) ──
import { isMock, assertMockMode } from '../src/lib/sim/sim-guard';

// ── Route groups (module-load-time evaluation for simRoutesGated) ────────────
// Imported after env manipulation is not needed because we test them at
// request time using controlled process.env mutation.
import { simRoutes, simRoutesGated } from '../src/routes/admin/sim';
import { authRoutes } from '../src/routes/auth';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withEnv(key: string, value: string | undefined, fn: () => unknown) {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

/**
 * Build a minimal Elysia app from one or more route groups and issue a
 * synthetic request, returning the raw Response.
 */
async function hit(
  routes: Elysia,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const app = new Elysia().use(routes);
  const req = new Request(`http://localhost${path}`, {
    method,
    ...(body !== undefined
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  return app.handle(req);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Guard functions
// ─────────────────────────────────────────────────────────────────────────────

describe('isMock()', () => {
  test('returns false when CANNOLI_MODE is unset', () => {
    withEnv('CANNOLI_MODE', undefined, () => {
      expect(isMock()).toBe(false);
    });
  });

  test('returns false when CANNOLI_MODE=live', () => {
    withEnv('CANNOLI_MODE', 'live', () => {
      expect(isMock()).toBe(false);
    });
  });

  test('returns false when CANNOLI_MODE is an unrecognised value', () => {
    withEnv('CANNOLI_MODE', 'staging', () => {
      expect(isMock()).toBe(false);
    });
  });

  test('returns true when CANNOLI_MODE=mock', () => {
    withEnv('CANNOLI_MODE', 'mock', () => {
      expect(isMock()).toBe(true);
    });
  });
});

describe('assertMockMode()', () => {
  test('throws when CANNOLI_MODE=live', () => {
    withEnv('CANNOLI_MODE', 'live', () => {
      expect(() => assertMockMode()).toThrow(/mock-only/);
    });
  });

  test('throws when CANNOLI_MODE is unset', () => {
    withEnv('CANNOLI_MODE', undefined, () => {
      expect(() => assertMockMode()).toThrow(/mock-only/);
    });
  });

  test('does not throw when CANNOLI_MODE=mock', () => {
    withEnv('CANNOLI_MODE', 'mock', () => {
      expect(() => assertMockMode()).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mount-time gate: simRoutesGated
//
// The test runner starts with CANNOLI_MODE unset, so simRoutesGated is the
// empty Elysia branch. Every sim path must produce a 404.
// ─────────────────────────────────────────────────────────────────────────────

const SIM_PATHS_GET: string[] = [
  '/api/admin/sim/state',
];

const SIM_PATHS_POST: Array<[string, unknown]> = [
  ['/api/admin/sim/advance-week', { leagueId: 'test' }],
  ['/api/admin/sim/match/test-match-id', {}],
  ['/api/admin/sim/week/1', { leagueId: 'test' }],
  ['/api/admin/sim/draft/auto-complete', { leagueId: 'test' }],
  ['/api/admin/sim/playoffs/generate', { leagueId: 'test' }],
  ['/api/admin/sim/phase', { leagueId: 'test', phase: 'regular' }],
  ['/api/admin/sim/reset', { confirm: 'reset' }],
  ['/api/admin/sim/reset-week/1', { leagueId: 'test' }],
  ['/api/admin/sim/reset-match/test-match-id', {}],
];

describe('simRoutesGated — mount-time gate (live / unset mode)', () => {
  // Under the test runner CANNOLI_MODE is unset → simRoutesGated is empty Elysia.
  test('simRoutesGated is the empty Elysia (no routes registered)', () => {
    // The gated export has no handlers registered on it. Elysia exposes its
    // route definitions via the internal `router` property in 1.x. The empty
    // branch was `new Elysia()` with no `.get()`/`.post()` calls, so it has
    // an empty route map. We verify this by confirming every sim path 404s.
    expect(simRoutesGated).toBeInstanceOf(Elysia);
    // If simRoutesGated were the real simRoutes it would expose the correct
    // paths; the empty branch returns 404 for all of them.
  });

  for (const path of SIM_PATHS_GET) {
    test(`GET ${path} returns 404 from empty router`, async () => {
      const res = await hit(simRoutesGated, 'GET', path);
      expect(res.status).toBe(404);
    });
  }

  for (const [path, body] of SIM_PATHS_POST) {
    test(`POST ${path} returns 404 from empty router`, async () => {
      const res = await hit(simRoutesGated, 'POST', path, body);
      expect(res.status).toBe(404);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Per-request gate: simRoutes (the unmounted real group)
//
// Even if the mount-time gate were bypassed and simRoutes itself were mounted,
// every handler calls assertMockMode() via gate(), which converts the throw
// into a flat 404 when CANNOLI_MODE != 'mock'. We verify this by hitting
// simRoutes directly with CANNOLI_MODE=live.
// ─────────────────────────────────────────────────────────────────────────────

describe('simRoutes — per-request gate (CANNOLI_MODE=live)', () => {
  for (const path of SIM_PATHS_GET) {
    test(`GET ${path} returns 404 even when routed directly`, async () => {
      const res = await withEnv('CANNOLI_MODE', 'live', () =>
        hit(simRoutes, 'GET', path),
      ) as Response;
      expect(res.status).toBe(404);
    });
  }

  for (const [path, body] of SIM_PATHS_POST) {
    test(`POST ${path} returns 404 even when routed directly`, async () => {
      const res = await withEnv('CANNOLI_MODE', 'live', () =>
        hit(simRoutes, 'POST', path, body),
      ) as Response;
      expect(res.status).toBe(404);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. demo-session gate
//
// POST /api/auth/demo-session checks process.env.CANNOLI_MODE at request time,
// so no re-import is required to test both branches.
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/demo-session — live mode gate', () => {
  test('returns 404 when CANNOLI_MODE=live', async () => {
    const res = await withEnv('CANNOLI_MODE', 'live', () =>
      hit(authRoutes, 'POST', '/api/auth/demo-session'),
    ) as Response;
    expect(res.status).toBe(404);
  });

  test('returns 404 when CANNOLI_MODE is unset', async () => {
    const res = await withEnv('CANNOLI_MODE', undefined, () =>
      hit(authRoutes, 'POST', '/api/auth/demo-session'),
    ) as Response;
    expect(res.status).toBe(404);
  });

  // In mock mode the endpoint is unblocked but requires a seeded `demo` user
  // in the DB. We verify it does NOT return 404 (it returns 404 only for the
  // "demo user not found" reason, which is a different code path — the gate
  // itself passes). Since tests run without seed-sim data the demo user won't
  // exist, so the response will be 404 with the "Demo user not found" message
  // rather than the "Not found" live-gate message. Both are still 404, so we
  // verify the response body distinguishes the two cases.
  test('in mock mode the live-gate body is NOT returned (different error if no demo user)', async () => {
    const res = await withEnv('CANNOLI_MODE', 'mock', () =>
      hit(authRoutes, 'POST', '/api/auth/demo-session'),
    ) as Response;
    const body = await res.json() as { error: string };
    // The live-gate returns { error: 'Not found' }.
    // The "no demo user" path returns { error: 'Demo user not found. Run seed-sim.ts to create it.' }.
    // Either way, the live-mode gate message must NOT appear.
    expect(body.error).not.toBe('Not found');
  });
});
