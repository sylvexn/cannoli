/**
 * Tickets: feedback -> ticket (no GitHub), status moves + reporter notification,
 * summary shape, staff gating, and the GitHub import mapping/idempotency
 * (mocked fetch). Runs inside one BEGIN/ROLLBACK on the shared dev DB.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { feedbackRoutes } from '../src/routes/feedback';
import { ticketRoutes } from '../src/routes/admin/tickets';
import { fetchIssues, importIssues, mapStatus, type GhIssue } from '../scripts/import-github-issues';

const tag = `tk${Date.now() % 100000}`;
let STAFF: { id: string; username: string; role: string };
let COACH: { id: string; username: string; role: string };
const asUser = { current: null as null | { id: string; username: string; role: string } };

const app = new Elysia()
  .derive(() => ({ user: asUser.current, sessionToken: null }))
  .use(feedbackRoutes).use(ticketRoutes);

async function call(method: string, path: string, body?: unknown) {
  const res = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

beforeAll(() => {
  sqlite.exec('BEGIN');
  const mk = (n: string, role: string) => {
    const u = db.insert(schema.users).values({
      username: `${tag}-${n}`, passwordHash: 'x', role: role as 'admin', mustChangePassword: false, active: true,
    }).returning().get();
    return { id: String(u.id), username: u.username, role };
  };
  STAFF = mk('staff', 'admin');
  COACH = mk('coach', 'user');
});
afterAll(() => { try { sqlite.exec('ROLLBACK'); } catch { /* closed */ } });

describe('feedback -> ticket', () => {
  test('submit creates a ticket and makes no network call', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls++; return Promise.reject(new Error('no network')); }) as unknown as typeof fetch;
    asUser.current = COACH;
    const form = new FormData();
    form.set('category', 'bug'); form.set('title', `${tag} broken`); form.set('description', 'it broke'); form.set('page', '/x');
    const res = await app.handle(new Request('http://localhost/api/feedback', { method: 'POST', body: form }));
    const json = await res.json() as any;
    globalThis.fetch = realFetch;
    expect(res.status).toBe(200);
    expect(calls).toBe(0);
    const t = db.select().from(schema.tickets).where(eq(schema.tickets.id, json.ticketId)).get()!;
    expect(t).toMatchObject({ status: 'new', type: 'bug', pageUrl: '/x', reporterUserId: Number(COACH.id), feedbackId: json.id });
  });
});

describe('status moves', () => {
  let id: number;
  test('Fixed notifies the reporter with a patch-notes link; moving within open states does not', async () => {
    id = db.insert(schema.tickets).values({ title: `${tag} t`, body: 'b', reporterUserId: Number(COACH.id) }).returning().get().id;
    asUser.current = STAFF;
    expect((await call('PATCH', `/api/admin/tickets/${id}`, { status: 'triaged' })).status).toBe(200);
    const notes = () => db.select().from(schema.notifications).where(eq(schema.notifications.userId, Number(COACH.id))).all();
    expect(notes().length).toBe(0);

    expect((await call('PATCH', `/api/admin/tickets/${id}`, { status: 'fixed', fixedIn: '1.4' })).status).toBe(200);
    const n = notes();
    expect(n.length).toBe(1);
    expect(n[0]).toMatchObject({ category: 'feedback', link: '/patch-notes#v1.4' });
    const t = db.select().from(schema.tickets).where(eq(schema.tickets.id, id)).get()!;
    expect(t).toMatchObject({ status: 'fixed', fixedIn: '1.4' });
    expect(t.closedAt).not.toBeNull();

    await call('PATCH', `/api/admin/tickets/${id}`, { status: 'wont_fix' });
    expect(notes().length).toBe(2);
  });

  test('reopen then fixed again notifies a second time', async () => {
    const tid = db.insert(schema.tickets).values({ title: `${tag} re`, body: 'b', reporterUserId: Number(COACH.id) }).returning().get().id;
    asUser.current = STAFF;
    const count = () => db.select().from(schema.notifications).where(eq(schema.notifications.userId, Number(COACH.id))).all()
      .filter(n => String(n.metadata).includes(`"ticketId":${tid}`)).length;
    await call('PATCH', `/api/admin/tickets/${tid}`, { status: 'fixed', fixedIn: '1.4' });
    await call('PATCH', `/api/admin/tickets/${tid}`, { status: 'triaged' });
    await call('PATCH', `/api/admin/tickets/${tid}`, { status: 'fixed', fixedIn: '1.4.1' });
    expect(count()).toBe(2);
  });

  test('feedback page keeps same-site paths only', async () => {
    asUser.current = COACH;
    const pageFor = async (page: string) => {
      const form = new FormData();
      form.set('category', 'bug'); form.set('title', `${tag} pg`); form.set('description', 'd'); form.set('page', page);
      const j = await (await app.handle(new Request('http://localhost/api/feedback', { method: 'POST', body: form }))).json() as any;
      return db.select().from(schema.tickets).where(eq(schema.tickets.id, j.ticketId)).get()!.pageUrl;
    };
    expect(await pageFor('/league/x')).toBe('/league/x');
    for (const bad of ['https://evil.test', '//evil.test', 'javascript:alert(1)']) expect(await pageFor(bad)).toBeNull();
    asUser.current = STAFF;
  });

  test('bad input rejected, notes recorded in detail', async () => {
    expect((await call('PATCH', `/api/admin/tickets/${id}`, { status: 'nope' })).status).toBe(400);
    expect((await call('PATCH', `/api/admin/tickets/${id}`, { fixedIn: 'x' })).status).toBe(400);
    expect((await call('POST', `/api/admin/tickets/${id}/notes`, { text: 'hello' })).status).toBe(200);
    const d = (await call('GET', `/api/admin/tickets/${id}`)).json;
    expect(d.key).toBe(`CAN-${id}`);
    expect(d.events.map((e: any) => e.kind)).toContain('note');
  });
});

describe('summary + gating', () => {
  test('summary shape', async () => {
    asUser.current = STAFF;
    const { json } = await call('GET', '/api/admin/tickets/summary');
    expect(Object.keys(json.byStatus).sort()).toEqual(['fixed', 'in_progress', 'new', 'triaged', 'wont_fix']);
    expect(Array.isArray(json.recent)).toBe(true);
    expect(json.recent.length).toBeLessThanOrEqual(5);
    for (const r of json.recent) expect(['new', 'triaged', 'in_progress']).toContain(r.status);
  });

  test('non-staff 403, anonymous 401', async () => {
    asUser.current = COACH;
    expect((await call('GET', '/api/admin/tickets')).status).toBe(403);
    expect((await call('PATCH', '/api/admin/tickets/1', { status: 'fixed' })).status).toBe(403);
    asUser.current = null;
    expect((await call('GET', '/api/admin/tickets/summary')).status).toBe(401);
  });
});

describe('github import', () => {
  const base = 900000 + (Date.now() % 1000) * 3;
  const issue = (n: number, o: Partial<GhIssue>): GhIssue => ({
    number: n, title: `${tag} gh${n}`, body: null, state: 'open', labels: [], html_url: `https://github.com/x/y/issues/${n}`,
    created_at: '2026-01-01T00:00:00Z', closed_at: null, ...o,
  });

  test('status mapping', () => {
    expect(mapStatus(issue(1, {}))).toBe('new');
    expect(mapStatus(issue(1, { state: 'closed' }))).toBe('fixed');
    expect(mapStatus(issue(1, { state: 'closed', state_reason: 'not_planned' }))).toBe('wont_fix');
    expect(mapStatus(issue(1, { state: 'closed', labels: [{ name: 'wontfix' }] }))).toBe('wont_fix');
  });

  test('dry run writes nothing; apply maps + links feedback; rerun is idempotent', async () => {
    const fb = db.insert(schema.feedback).values({
      userId: Number(COACH.id), category: 'bug', title: 'f', body: 'b', page: '/p', githubIssueNumber: base + 1,
    }).returning().get();
    const issues = [
      issue(base + 1, { state: 'closed', closed_at: '2026-01-05T00:00:00Z', labels: ['bug'] }),
      issue(base + 2, { body: `x\n**Reporter:** ${COACH.username} (user)`, labels: [{ name: 'enhancement' }] }),
      issue(base + 3, { pull_request: {} }),
    ];
    const mockFetch = (async (url: string) => new Response(JSON.stringify(String(url).includes('page=1') ? issues : []))) as unknown as typeof fetch;
    const fetched = await fetchIssues('tok', 'x/y', mockFetch);
    expect(fetched.length).toBe(3);

    expect(importIssues(fetched, false).inserted).toEqual([base + 1, base + 2]);
    expect(db.select().from(schema.tickets).where(eq(schema.tickets.id, base + 1)).get()).toBeUndefined();

    importIssues(fetched, true);
    const a = db.select().from(schema.tickets).where(eq(schema.tickets.id, base + 1)).get()!;
    expect(a).toMatchObject({ status: 'fixed', type: 'bug', feedbackId: fb.id, reporterUserId: Number(COACH.id), pageUrl: '/p', closedAt: '2026-01-05T00:00:00Z' });
    const b = db.select().from(schema.tickets).where(eq(schema.tickets.id, base + 2)).get()!;
    expect(b).toMatchObject({ status: 'new', type: 'idea', reporterUserId: Number(COACH.id), githubUrl: `https://github.com/x/y/issues/${base + 2}` });

    const again = importIssues(fetched, true);
    expect(again.inserted).toEqual([]);
    expect(again.skipped).toEqual([base + 1, base + 2]);
    expect(db.select().from(schema.ticketEvents).where(and(eq(schema.ticketEvents.ticketId, base + 1), eq(schema.ticketEvents.kind, 'import'))).all().length).toBe(1);
  });
});
