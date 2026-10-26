/**
 * PUT /api/site-settings is a partial update: a form that edits a few settings
 * must never reset the others to defaults (the console only sends its fields).
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { configRoutes } from '../src/routes/admin/config';

const STAFF = { id: '1', username: 'tester', role: 'admin' as const };
const app = () => new Elysia().derive(() => ({ user: STAFF, sessionToken: 't' })).use(configRoutes);
const put = async (body: unknown) => {
  const res = await app().handle(new Request('http://localhost/api/site-settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return res.status;
};
const row = () => db.select().from(schema.siteSettings).where(eq(schema.siteSettings.id, 1)).get()!;

// The settings row may not exist yet on a fresh test DB; create it (and drop it after) if so.
const existed = !!db.select().from(schema.siteSettings).where(eq(schema.siteSettings.id, 1)).get();
if (!existed) db.insert(schema.siteSettings).values({ id: 1 }).run();
const original = row();
afterAll(() => {
  try {
    if (existed) db.update(schema.siteSettings).set(original).where(eq(schema.siteSettings.id, 1)).run();
    else db.delete(schema.siteSettings).where(eq(schema.siteSettings.id, 1)).run();
  } catch { /* DB closed */ }
});

describe('site settings PUT', () => {
  test('only the keys sent are written', async () => {
    expect(await put({ faDeadlineWeek: 9, faPickupsPerSeason: 4 })).toBe(200);
    expect(await put({ draftTimerEnabled: !original.draftTimerEnabled })).toBe(200);
    const r = row();
    expect(r.faDeadlineWeek).toBe(9);
    expect(r.faPickupsPerSeason).toBe(4);
    expect(r.draftTimerEnabled).toBe(!original.draftTimerEnabled);
    expect(r.defaultUserPassword).toBe(original.defaultUserPassword);
  });

  test('rejects a non-integer week', async () => {
    expect(await put({ faDeadlineWeek: 'soon' })).toBe(400);
    expect(row().faDeadlineWeek).toBe(9);
  });
});
