/**
 * Patch notes + personal bell: legacy-entry conversion (sections, version, hotfix
 * nesting, idempotency), draft/publish + unread counting (top-level published
 * only), the bell no longer carrying changelog, category tabs and mark-all-read.
 * Runs inside one BEGIN/ROLLBACK on the shared dev DB.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { changelogRoutes } from '../src/routes/changelog';
import { notificationRoutes } from '../src/routes/notifications';
import {
  parseLegacyBody, parseLegacyTitle, migrateChangelogStructure, countUnreadPatches,
} from '../src/lib/patch-notes';
import { notifyUser } from '../src/lib/notifications/notify';

const tag = `pn${Date.now() % 100000}`;
let STAFF: { id: string; username: string; role: string };
let COACH: { id: string; username: string; role: string };
const asUser = { current: null as null | { id: string; username: string; role: string } };

const app = new Elysia()
  .derive(() => ({ user: asUser.current, sessionToken: null }))
  .use(changelogRoutes).use(notificationRoutes);

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

describe('legacy conversion', () => {
  test('body tags map to sections; untagged lines fall to Changes', () => {
    const s = parseLegacyBody('- Added thing (feature)\n- Tweaked (improvement)\n- Broke less (fix)\n- Fixed two (fix)\nplain line');
    expect(s.map(x => x.kind)).toEqual(['new', 'changes', 'fixes']);
    expect(s[0]!.items).toEqual(['Added thing']);
    expect(s[1]!.items).toEqual(['Tweaked', 'plain line']);
    expect(s[2]!.items).toEqual(['Broke less', 'Fixed two']);
  });

  test('title splits into version + theme', () => {
    expect(parseLegacyTitle('Cannoli v1.2 — Approvals')).toEqual({ version: '1.2', theme: 'Approvals' });
    expect(parseLegacyTitle('Cannoli 1.0 — Day 1 patch')).toEqual({ version: '1.0', theme: 'Day 1 patch' });
    expect(parseLegacyTitle('Something else').version).toBeNull();
  });

  test('migrate converts, nests hotfixes, and is idempotent', () => {
    const ins = (id: string, title: string, body: string) => db.insert(schema.changelog).values({
      id: `${tag}-${id}`, date: '2099-01-01T00:00:00Z', category: 'improvement', title, body,
    }).run();
    ins('p', 'Cannoli v98.1 — Parent', '- A (feature)');
    ins('h', 'Cannoli v98.1.1 — Hot', '- B (fix)');
    expect(migrateChangelogStructure()).toBeGreaterThanOrEqual(2);
    const p = db.select().from(schema.changelog).where(eq(schema.changelog.id, `${tag}-p`)).get()!;
    const h = db.select().from(schema.changelog).where(eq(schema.changelog.id, `${tag}-h`)).get()!;
    expect([p.version, p.title, p.parentId]).toEqual(['98.1', 'Parent', null]);
    expect(JSON.parse(p.sections!)).toEqual([{ kind: 'new', items: ['A'] }]);
    expect([h.version, h.title, h.parentId]).toEqual(['98.1.1', 'Hot', `${tag}-p`]);
    expect(p.body).toBe('- A (feature)'); // legacy body preserved
    expect(migrateChangelogStructure()).toBe(0);
    db.delete(schema.changelog).where(eq(schema.changelog.id, `${tag}-h`)).run();
    db.delete(schema.changelog).where(eq(schema.changelog.id, `${tag}-p`)).run();
  });
});

describe('draft / publish / unread', () => {
  test('staff only; drafts hidden; publish stamps date; hotfix nests and never counts', async () => {
    asUser.current = COACH;
    expect((await call('POST', '/api/admin/changelog', { title: 'x' })).status).toBe(403);

    asUser.current = STAFF;
    const before = countUnreadPatches(null);
    const created = await call('POST', '/api/admin/changelog', {
      id: `${tag}-v97`, version: '97.0', title: 'Big one', sections: [{ kind: 'new', items: ['Thing'] }],
    });
    expect(created.status).toBe(200);
    expect(countUnreadPatches(null)).toBe(before); // draft not counted

    asUser.current = null;
    let pub = await call('GET', '/api/changelog');
    expect(pub.json.patches.find((p: any) => p.id === `${tag}-v97`)).toBeUndefined();

    asUser.current = STAFF;
    expect((await call('POST', `/api/admin/changelog/${tag}-v97/publish`)).status).toBe(200);
    expect(countUnreadPatches(null)).toBe(before + 1);

    const hot = await call('POST', '/api/admin/changelog', {
      id: `${tag}-v97-1`, version: '97.0.1', title: 'Hotfix', parentId: `${tag}-v97`,
      sections: [{ kind: 'fixes', items: ['Fixed'] }], status: 'published',
    });
    expect(hot.status).toBe(200);
    expect(countUnreadPatches(null)).toBe(before + 1); // hotfix doesn't add a pulse

    asUser.current = COACH;
    pub = await call('GET', '/api/changelog');
    const parent = pub.json.patches.find((p: any) => p.id === `${tag}-v97`);
    expect(parent.hotfixes.map((h: any) => h.id)).toEqual([`${tag}-v97-1`]);
    expect(pub.json.patches.find((p: any) => p.id === `${tag}-v97-1`)).toBeUndefined();
    expect(pub.json.unreadCount).toBe(before + 1);

    // seen clears the badge
    expect((await call('POST', '/api/changelog/seen')).status).toBe(200);
    expect((await call('GET', '/api/changelog')).json.unreadCount).toBe(0);
  });

  test('rejects malformed sections and nesting under a hotfix', async () => {
    asUser.current = STAFF;
    expect((await call('POST', '/api/admin/changelog', { title: 't', sections: [{ kind: 'nope', items: [] }] })).status).toBe(400);
    const r = await call('POST', '/api/admin/changelog', { title: 't', parentId: `${tag}-v97-1`, sections: [] });
    expect(r.status).toBe(400);
    expect((await call('DELETE', `/api/admin/changelog/${tag}-v97`)).status).toBe(409); // has hotfix
  });
});

describe('bell', () => {
  test('excludes changelog, files rows by category, mark-all-read per group and global', async () => {
    notifyUser(Number(COACH.id), { type: 'system', category: 'trades', title: 'T1', dedupeKey: `${tag}:t` });
    notifyUser(Number(COACH.id), { type: 'feedback', title: 'F1', dedupeKey: `${tag}:f` });
    notifyUser(Number(COACH.id), { type: 'system', title: 'A1', dedupeKey: `${tag}:a` });

    asUser.current = COACH;
    let feed = (await call('GET', '/api/notifications')).json;
    expect(feed.items.every((i: any) => i.source !== 'changelog')).toBe(true);
    const by = (g: string) => feed.items.filter((i: any) => i.group === g).map((i: any) => i.title);
    expect(by('trades')).toEqual(['T1']);
    expect(by('feedback')).toEqual(['F1']);
    expect(by('admin')).toContain('A1');
    expect(feed.unreadByGroup.trades).toBe(1);
    expect(feed.unreadCount).toBe(feed.items.filter((i: any) => !i.read).length);

    await call('POST', '/api/notifications/seen', { group: 'trades' });
    feed = (await call('GET', '/api/notifications')).json;
    expect(feed.unreadByGroup.trades).toBe(0);
    expect(feed.unreadByGroup.feedback).toBe(1);

    await call('POST', '/api/notifications/seen', {});
    feed = (await call('GET', '/api/notifications')).json;
    expect(feed.unreadCount).toBe(0);
  });

  test('guests get an empty feed', async () => {
    asUser.current = null;
    const feed = (await call('GET', '/api/notifications')).json;
    expect(feed.items).toEqual([]);
    expect(feed.unreadCount).toBe(0);
  });
});
