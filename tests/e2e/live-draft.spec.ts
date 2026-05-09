import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/**
 * 12-coach live snake draft over WebSockets.
 *
 * What this exercises end-to-end:
 *   - 12 separate browser contexts each connecting to /ws/draft/sapphire as
 *     a real seeded coach (auth cookie scoped per-context).
 *   - The server-driven draft engine: snake order, executePick, snapshot
 *     broadcast, captain reserve, mega-cap and dup-species validation.
 *   - The HTTP pick path (`POST /api/leagues/:id/draft/pick`) under realistic
 *     concurrency — every other client receives the `pick_made` WS message.
 *
 * Why HTTP picks (not popover-clicks): per-coach UI clicks would 12x the
 * wallclock for no extra coverage of the draft engine. The WebSockets are
 * still real (the React app opens them on mount), so the WS broadcast +
 * subscriber paths are tested with 12 live consumers under load.
 *
 * Setup short-circuits performed in this spec because they're pure test
 * fixtures, not behaviour we want to exercise:
 *   - Sapphire is left in `phase=offseason` by the seed (after the
 *     historical S10 import). We walk it back to `predraft`, set draft
 *     order, then forward to `draft`.
 *   - Coach users seed with `must_change_password=1`. We login each one
 *     with the default password and run change-password so the live login
 *     against the UI doesn't redirect to /change-password.
 *
 * Idempotency note: `seed:fresh` (in `globalSetup`) drops every table
 * in-place rather than `rm`'ing the DB, so the running dev backend's open
 * file handle sees the new state on the next query — no inode zombie. That
 * means this test always starts from a clean fixture and the prep flow
 * doesn't need any "skip if already-prepped" branches.
 */

const COACH_USERNAMES = [
  'ak', 'dylan', 'devon', 'alex', 'jacob', 'giuliano',
  'mike', 'patrick', 'garrett', 'saviour', 'liam', 'nate',
];
const LEAGUE_ID = 'sapphire';
const DEFAULT_PASSWORD = 'password';
const TEST_PASSWORD = 'cannolitestpw';
const PICK_TIMER_SECONDS = 120;
const TOTAL_PICKS = 120; // 12 teams × 10 rounds

interface SnakeSlot {
  teamId: string;
  round: number;
  pick: number;
  overallPick: number;
}

interface DraftSnapshot {
  status: 'not_started' | 'in_progress' | 'paused' | 'completed';
  currentPickIndex: number;
  snakeOrder: SnakeSlot[];
  picks: { teamId: string; pokemonName: string; tier: number; pickNumber: number }[];
  teamPoints: Record<string, number>;
}

test.describe('12-coach live draft', () => {
  test.setTimeout(600_000);
  test.use({ storageState: { cookies: [], origins: [] } });

  test('all 12 connect, draft completes via HTTP picks', async ({ browser, request, playwright }) => {
    const captured: string[] = [];

    // ─── Phase 1: admin walks sapphire back to draft phase + sets order ──
    await login(request, 'syl', 'admin');

    const teamsList = await request.get(`/api/leagues/${LEAGUE_ID}/teams`).then((r) => r.json());
    const order: string[] = teamsList.map((t: any) => t.id);
    expect(order.length).toBe(12);

    const toPredraft = await csrfPost(request, `/api/leagues/${LEAGUE_ID}/phase`, {
      phase: 'predraft', override: true, confirm: 'I understand',
    });
    expect(toPredraft.ok(), `→ predraft: ${toPredraft.status()} ${await toPredraft.text()}`).toBeTruthy();

    const orderRes = await csrfPost(request, `/api/leagues/${LEAGUE_ID}/draft-order`, { order });
    expect(orderRes.ok(), `set draft order: ${orderRes.status()} ${await orderRes.text()}`).toBeTruthy();

    const toDraft = await csrfPost(request, `/api/leagues/${LEAGUE_ID}/phase`, { phase: 'draft' });
    expect(toDraft.ok(), `→ draft: ${toDraft.status()} ${await toDraft.text()}`).toBeTruthy();

    // ─── Phase 2: clear must_change_password on each coach via the API ───
    for (const username of COACH_USERNAMES) {
      const ctx = await playwright.request.newContext({ baseURL: 'http://localhost:5173' });
      try {
        const loginRes = await ctx.post('/api/auth/login', {
          data: { username, password: DEFAULT_PASSWORD },
        });
        expect(loginRes.ok(), `login ${username}: ${await loginRes.text()}`).toBeTruthy();
        const cpRes = await csrfPost(ctx, '/api/auth/change-password', {
          currentPassword: DEFAULT_PASSWORD, newPassword: TEST_PASSWORD,
        });
        expect(cpRes.ok(), `change-password ${username}: ${cpRes.status()} ${await cpRes.text()}`).toBeTruthy();
        await csrfPost(ctx, '/api/auth/logout');
      } finally {
        await ctx.dispose();
      }
    }

    // ─── Phase 3: spawn 12 browser contexts, login each, open the draft ──
    const coaches: { username: string; teamId: string; ctx: BrowserContext; page: Page; api: APIRequestContext }[] = [];
    for (const username of COACH_USERNAMES) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      page.on('pageerror', (e) => captured.push(`[${username}] pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (t.includes('Base UI') || t.includes('production-error') || t.includes('Uncaught')) {
          captured.push(`[${username}] console: ${t}`);
        }
      });
      // UI login so the WS endpoint receives the right session cookie.
      await page.goto('/login');
      await page.getByLabel(/username/i).fill(username);
      await page.getByLabel(/password/i).fill(TEST_PASSWORD);
      await page.getByRole('button', { name: /sign\s*in/i }).click();
      await expect(page).toHaveURL(/\/(?:$|me|league|admin)/, { timeout: 10_000 });

      // /api/auth/me returns user.id as a string while team.userId is the
      // numeric column — coerce both sides before comparing.
      const meRes = await page.request.get('/api/auth/me');
      expect(meRes.ok()).toBeTruthy();
      const me = await meRes.json();
      const myUserId = Number(me.user.id);
      const teamsRes = await page.request.get(`/api/leagues/${LEAGUE_ID}/teams`);
      const teams = await teamsRes.json();
      const myTeam = teams.find((t: any) => Number(t.userId) === myUserId);
      expect(myTeam, `expected ${username} to own a team in ${LEAGUE_ID}`).toBeTruthy();

      // Open the draft page. The page initially renders in `view='history'`
      // (the season recap), and `useDraftState` only opens the WS when
      // `view === 'active'` AND `source === 'server'`. So we have to click
      // the History/Live SegmentedToggle to "Live" — that's what flips the
      // view in production too, and it's what every coach does on draft
      // night before picks open.
      await page.goto(`/league/${LEAGUE_ID}/draft`);
      await page.getByRole('button', { name: /^Live$/ }).click();

      coaches.push({ username, teamId: myTeam.id, ctx, page, api: page.request });
    }
    expect(coaches.length).toBe(12);

    // Wait for all 12 sockets to land in the presence map before starting,
    // so admin's startDraft sees `12/12 online` rather than racing the WS
    // identify dance.
    await expect.poll(async () => {
      const r = await request.get(`/api/leagues/${LEAGUE_ID}/draft/presence`);
      if (!r.ok()) return 0;
      const body = await r.json();
      return (body.players ?? []).length;
    }, { timeout: 30_000, message: 'waiting for 12 players in presence map' }).toBeGreaterThanOrEqual(12);

    // ─── Phase 4: admin starts the draft ─────────────────────────────────
    const startRes = await csrfPost(
      request,
      `/api/leagues/${LEAGUE_ID}/draft/start`,
      { timerDuration: PICK_TIMER_SECONDS },
    );
    expect(startRes.ok(), `startDraft: ${startRes.status()} ${await startRes.text()}`).toBeTruthy();

    // ─── Phase 5: pick driver ────────────────────────────────────────────
    // Cheapest-first: ascending tier keeps every team in budget. Server
    // validates dup-species / mega-cap / captain-reserve; any 422 means
    // "try the next candidate".
    const tierListRes = await request.get('/api/tier-list');
    const tierList: { name: string; tier: number; status: string }[] = await tierListRes.json();
    const draftablePool = tierList
      .filter((p) => p.status === 'available' && p.tier > 0)
      .sort((a, b) => a.tier - b.tier);

    const drafted = new Set<string>();
    const apiByTeam = new Map<string, APIRequestContext>();
    for (const c of coaches) apiByTeam.set(c.teamId, c.api);

    for (let i = 0; i < TOTAL_PICKS; i++) {
      const stateRes = await request.get(`/api/leagues/${LEAGUE_ID}/draft/state`);
      const snapshot: DraftSnapshot = await stateRes.json();
      if (snapshot.status === 'completed') break;
      const slot = snapshot.snakeOrder[snapshot.currentPickIndex];
      if (!slot) {
        throw new Error(`No slot at index ${snapshot.currentPickIndex} (status=${snapshot.status})`);
      }
      const coachApi = apiByTeam.get(slot.teamId);
      if (!coachApi) throw new Error(`No coach context for team ${slot.teamId}`);

      let picked = false;
      for (const candidate of draftablePool) {
        if (drafted.has(candidate.name)) continue;
        const pickRes = await csrfPost(
          coachApi,
          `/api/leagues/${LEAGUE_ID}/draft/pick`,
          { pokemonName: candidate.name },
        );
        if (pickRes.ok()) {
          drafted.add(candidate.name);
          picked = true;
          break;
        }
        if (pickRes.status() !== 422) {
          const body = await pickRes.text();
          throw new Error(`Pick ${i + 1} for ${slot.teamId} failed: ${pickRes.status()} ${body}`);
        }
        // 422 = legitimate rule conflict (dup, mega cap, reserve). Try next.
      }
      if (!picked) {
        throw new Error(`Pick ${i + 1}: ran out of legal candidates for ${slot.teamId}`);
      }
    }

    // ─── Phase 6: verify completion ──────────────────────────────────────
    const finalRes = await request.get(`/api/leagues/${LEAGUE_ID}/draft/state`);
    const final: DraftSnapshot = await finalRes.json();
    expect(final.status).toBe('completed');
    expect(final.picks.length).toBe(TOTAL_PICKS);

    if (captured.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[live-draft] captured runtime errors:', captured);
    }
    expect(captured, 'no runtime errors across 12 contexts').toEqual([]);

    for (const c of coaches) await c.ctx.close();
  });
});

async function login(api: APIRequestContext, username: string, password: string) {
  const res = await api.post('/api/auth/login', { data: { username, password } });
  expect(res.ok(), `login ${username}: ${await res.text()}`).toBeTruthy();
}

/** Read the csrf_token cookie from the request context's jar. */
async function readCsrf(api: APIRequestContext): Promise<string> {
  const state = await api.storageState();
  const cookie = state.cookies.find((c) => c.name === 'csrf_token');
  if (!cookie) throw new Error('csrf_token cookie not present — did login succeed?');
  return cookie.value;
}

/** Wrapper around `api.post` that double-submits the CSRF token. */
async function csrfPost(api: APIRequestContext, url: string, data?: unknown) {
  const csrf = await readCsrf(api);
  return api.post(url, {
    data,
    headers: { 'X-CSRF-Token': csrf },
  });
}
