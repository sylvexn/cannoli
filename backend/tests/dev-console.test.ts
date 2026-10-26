import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { devConsoleRoutes } from '../src/routes/admin/dev-console';
import { BOOT_ID, LOG_CAPACITY, getLogs, pushLog, redact, resetLogBuffer } from '../src/lib/log-buffer';
import { getDeployStatus, resetCoolifyCache } from '../src/lib/coolify';

describe('log buffer', () => {
  beforeEach(resetLogBuffer);

  test('is bounded and keeps the newest lines', () => {
    for (let i = 0; i < LOG_CAPACITY + 50; i++) pushLog('info', `line ${i}`);
    const lines = getLogs();
    expect(lines.length).toBe(LOG_CAPACITY);
    expect(lines.at(-1)!.msg).toBe(`line ${LOG_CAPACITY + 49}`);
    expect(lines[0]!.msg).toBe('line 50');
  });

  test('lines carry the per-process boot id', () => {
    expect(pushLog('info', 'x').boot).toBe(BOOT_ID);
  });

  test('tags ps-bot source', () => {
    expect(pushLog('info', '[PS Bot] Connected').src).toBe('ps-bot');
    expect(pushLog('info', 'hello').src).toBe('backend');
  });

  test('redacts secrets before buffering', () => {
    const cases = [
      'Authorization: Bearer abc123def456',
      'headers cookie: session=abcd; csrf_token=zzz',
      'login {"username":"a","password":"hunter2"}',
      'PS_INTERNAL_SECRET=supersecret next=1',
      'fetch with Bearer eyJhbGciOi.payload.sig',
    ];
    for (const c of cases) pushLog('error', c);
    const joined = getLogs().map(l => l.msg).join('\n');
    for (const leak of ['abc123def456', 'abcd;', 'hunter2', 'supersecret', 'eyJhbGciOi', 'zzz']) {
      expect(joined).not.toContain(leak);
    }
    expect(redact('GET /api/health 200')).toBe('GET /api/health 200');
  });
});

describe('coolify proxy', () => {
  const saved = { u: process.env.COOLIFY_API_URL, t: process.env.COOLIFY_API_TOKEN };
  afterAll(() => {
    if (saved.u === undefined) delete process.env.COOLIFY_API_URL; else process.env.COOLIFY_API_URL = saved.u;
    if (saved.t === undefined) delete process.env.COOLIFY_API_TOKEN; else process.env.COOLIFY_API_TOKEN = saved.t;
    resetCoolifyCache();
  });
  beforeEach(resetCoolifyCache);

  test('not configured without env', async () => {
    delete process.env.COOLIFY_API_URL; delete process.env.COOLIFY_API_TOKEN;
    const fake = (() => { throw new Error('should not fetch'); }) as unknown as typeof fetch;
    expect(await getDeployStatus(fake)).toEqual({ configured: false });
  });

  test('maps apps, filters non-cannoli, caches 30s, sends bearer', async () => {
    process.env.COOLIFY_API_URL = 'https://coolify.test/'; process.env.COOLIFY_API_TOKEN = 'tok';
    let calls = 0; let auth = '';
    const fake = (async (url: string, init: RequestInit) => {
      calls++; auth = (init.headers as Record<string, string>).Authorization!;
      if (url.endsWith('/api/v1/applications')) return Response.json([
        { uuid: 'u1', name: 'cannoli-backend-live', status: 'running:healthy', fqdn: null, git_commit_sha: 'abcdef1234567890' },
        { uuid: 'u2', name: 'other-app', status: 'running:healthy' },
        { uuid: 'u3', name: 'cannoli-ps-client', status: 'running:unhealthy' },
      ]);
      if (url.endsWith('/u1')) return Response.json([{ commit: 'ffff0000aaaa1111', status: 'finished', finished_at: '2026-10-01T00:00:00Z' }]);
      return new Response('nope', { status: 500 }); // per-app failure is tolerated
    }) as unknown as typeof fetch;

    const r = await getDeployStatus(fake, 1000);
    if (!r.configured) throw new Error('expected configured');
    expect(auth).toBe('Bearer tok');
    expect(r.apps.map(a => a.name)).toEqual(['cannoli-backend-live', 'cannoli-ps-client']);
    expect(r.apps[0]).toMatchObject({ health: 'healthy', commit: 'ffff0000aaaa', lastDeployAt: '2026-10-01T00:00:00Z' });
    expect(r.apps[1]!.health).toBe('degraded');
    const n = calls;
    await getDeployStatus(fake, 20_000);
    expect(calls).toBe(n); // cached
    await getDeployStatus(fake, 40_000);
    expect(calls).toBeGreaterThan(n); // expired
  });

  test('upstream failure surfaces as error, not thrown', async () => {
    process.env.COOLIFY_API_URL = 'https://coolify.test'; process.env.COOLIFY_API_TOKEN = 'tok';
    const fake = (async () => new Response('x', { status: 401 })) as unknown as typeof fetch;
    const r = await getDeployStatus(fake);
    expect(r).toMatchObject({ configured: true, apps: [] });
    expect((r as { error?: string }).error).toContain('401');
  });
});

describe('dev console role gating', () => {
  const tag = `devcon-${Date.now()}`;
  const ids: number[] = [];
  const sess: Record<string, string> = {};
  const app = new Elysia()
    .derive(({ request }) => {
      const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
      return { user: token ? validateSession(token) : null, sessionToken: token };
    })
    .use(devConsoleRoutes);

  beforeAll(() => {
    for (const role of ['dev', 'admin', 'user'] as const) {
      const u = db.insert(schema.users).values({ username: `${tag}-${role}`, passwordHash: 'x', role, mustChangePassword: false, active: true }).returning().get();
      ids.push(u.id); sess[role] = createSession(u.id);
    }
  });
  afterAll(() => {
    try { for (const id of ids) { db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run(); db.delete(schema.users).where(eq(schema.users.id, id)).run(); } } catch { /* closed */ }
  });

  const get = (path: string, role?: string, signal?: AbortSignal) =>
    app.handle(new Request(`http://localhost${path}`, { headers: role ? { cookie: `session=${sess[role]}` } : {}, signal }));

  for (const path of ['/api/admin/dev/deploys', '/api/admin/dev/logs', '/api/admin/dev/logs/stream']) {
    test(`${path}: 401 anon, 403 admin/user`, async () => {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, 'user')).status).toBe(403);
      expect((await get(path, 'admin')).status).toBe(403);
    });
  }

  test('dev can read deploys + logs', async () => {
    delete process.env.COOLIFY_API_URL; delete process.env.COOLIFY_API_TOKEN;
    const d = await (await get('/api/admin/dev/deploys', 'dev')).json() as any;
    expect(d.deploys).toEqual({ configured: false });
    resetLogBuffer(); pushLog('info', 'visible line');
    const l = await (await get('/api/admin/dev/logs', 'dev')).json() as any;
    expect(l.lines.map((x: any) => x.msg)).toContain('visible line');
  });

  test('dev stream delivers new lines as SSE', async () => {
    const ac = new AbortController();
    const res = await get('/api/admin/dev/logs/stream', 'dev', ac.signal);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    pushLog('warn', 'streamed line');
    let text = '';
    const dec = new TextDecoder();
    while (!text.includes('streamed line')) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); }
    expect(text).toContain('"level":"warn"');
    ac.abort(); await reader.cancel().catch(() => {});
  });
});
