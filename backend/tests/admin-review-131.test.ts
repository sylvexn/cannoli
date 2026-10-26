/** Patch-notes guards (version uniqueness, hotfix-under-draft, date normalising) + unpublish week-date restore. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { db, schema, sqlite } from '../src/db';
import { changelogRoutes } from '../src/routes/changelog';
import { restoreWeekDates } from '../src/lib/playoff-publish';
import { eq } from 'drizzle-orm';

const tag = `ar${Date.now() % 100000}`;
const user = { id: '1', username: `${tag}-admin`, role: 'admin' };
const app = new Elysia().derive(() => ({ user, sessionToken: null })).use(changelogRoutes);
const send = async (method: string, path: string, body: unknown) => {
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => null) as any };
};

beforeAll(() => { sqlite.exec('BEGIN'); });
afterAll(() => { try { sqlite.exec('ROLLBACK'); } catch { /* closed */ } });

describe('changelog guards', () => {
  const v = `97.${Date.now() % 1000}`;
  test('duplicate version 409 on create and update; date normalised', async () => {
    const a = await send('POST', '/api/admin/changelog', { id: `${tag}-a`, title: 'A', version: v, date: '2026-01-02T03:04:05+02:00' });
    expect(a.status).toBe(200);
    expect(db.select().from(schema.changelog).where(eq(schema.changelog.id, `${tag}-a`)).get()!.date).toBe('2026-01-02T01:04:05.000Z');
    expect((await send('POST', '/api/admin/changelog', { id: `${tag}-b`, title: 'B', version: v })).status).toBe(409);
    await send('POST', '/api/admin/changelog', { id: `${tag}-c`, title: 'C', version: `${v}.1` });
    expect((await send('PUT', `/api/admin/changelog/${tag}-c`, { version: v })).status).toBe(409);
    expect((await send('PUT', `/api/admin/changelog/${tag}-a`, { version: v })).status).toBe(200); // own version is fine
  });

  test('published hotfix under a draft parent is refused', async () => {
    const r = await send('POST', '/api/admin/changelog', { id: `${tag}-h`, title: 'H', parentId: `${tag}-a`, status: 'published' });
    expect(r.status).toBe(409);
    expect((await send('POST', '/api/admin/changelog', { id: `${tag}-h`, title: 'H', parentId: `${tag}-a` })).status).toBe(200);
  });
});

describe('unpublish week dates', () => {
  test('removes only publish-added weeks, keeps later edits', () => {
    const id = `${tag}-lg`;
    const seasonId = db.insert(schema.seasons).values({ seasonNumber: 9999 }).returning().get().id;
    db.insert(schema.leagues).values({ id, name: id, color: '#fff', seasonId, weekDates: JSON.stringify({ '1': 'edited', '2': 'b', '9': 'added' }) } as never).run();
    expect(JSON.parse(restoreWeekDates(id, JSON.stringify({ '1': 'a', '2': 'b' }))!)).toEqual({ '1': 'edited', '2': 'b' });
    expect(restoreWeekDates(id, null)).toBeNull();
  });
});
