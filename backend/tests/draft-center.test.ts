/**
 * Draft Center — rules validator (pure) + owner-scoped CRUD / sharing routes.
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { createSession, parseSessionToken, validateSession } from '../src/lib/auth';
import { draftCenterRoutes } from '../src/routes/draft-center';
import { validateRoster, resolveRuleset, DEFAULT_RULESET, type Ruleset } from '../src/lib/draft-center/rules';
import { sanitizeRoster, type DcMon } from '../src/lib/draft-center/types';
import { buildCardSvg } from '../src/lib/draft-center/og-image';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

// Validator

const COSTS: Record<string, { tier: number; banned?: boolean; teraBanned?: boolean }> = {
  Garchomp: { tier: 18 }, Gengar: { tier: 13 }, Breloom: { tier: 11 },
  Muk: { tier: 4 }, Raboot: { tier: 2 }, Vigoroth: { tier: 3 },
  'Mega Alakazam': { tier: 19 }, 'Mega Scizor': { tier: 19 },
  Charizard: { tier: 7 }, 'Mega Charizard X': { tier: 20 },
  Mewtwo: { tier: 20, banned: true }, Alcremie: { tier: 5, teraBanned: true },
};
const lookup = (n: string) => {
  const c = COSTS[n];
  return c ? { tier: c.tier, banned: !!c.banned, teraBanned: !!c.teraBanned } : undefined;
};
const RS: Ruleset = { ...DEFAULT_RULESET, pointCap: 50, rosterSize: 4, rosterMax: null, teraCaptainSlots: 1 };
const mon = (name: string, over: Partial<DcMon> = {}): DcMon => ({ name, captain: false, teraTypes: [], ...over });
const codes = (r: DcMon[], rs = RS) => validateRoster(r, rs, lookup).violations.map(v => v.code);

describe('draft-center validator', () => {
  test('sums effective cost with captain markup (tier 4 captain costs 5)', () => {
    const v = validateRoster([mon('Gengar'), mon('Muk', { captain: true, teraTypes: ['dark', 'poison', 'ghost'] })], RS, lookup);
    expect(v.used).toBe(13 + 5);
    expect(v.remaining).toBe(50 - 18);
    expect(v.violations).toEqual([]);
  });

  test('over budget (incl. markup) is a warning, not an error', () => {
    const roster = [mon('Garchomp'), mon('Gengar'), mon('Breloom', { captain: true, teraTypes: ['grass', 'fighting', 'dark'] })];
    // 18 + 13 + (tier 11 > 9 so no markup) 11 = 42; add Raboot captain (2->2) stays under
    expect(codes(roster)).not.toContain('over_budget');
    expect(codes([...roster, mon('Mega Alakazam')])).toContain('over_budget');
  });

  test('flags more than one Mega', () => {
    expect(codes([mon('Mega Alakazam'), mon('Mega Scizor')])).toContain('multi_mega');
    expect(codes([mon('Mega Alakazam'), mon('Gengar')])).not.toContain('multi_mega');
  });

  test('flags duplicate species / national dex number (base + mega collide)', () => {
    expect(codes([mon('Charizard'), mon('Mega Charizard X')])).toContain('duplicate_species');
    expect(codes([mon('Charizard'), mon('Garchomp')])).not.toContain('duplicate_species');
  });

  test('flags roster overflow, banned, unknown', () => {
    expect(codes([mon('Muk'), mon('Raboot'), mon('Vigoroth'), mon('Gengar'), mon('Breloom')])).toContain('roster_over');
    expect(codes([mon('Mewtwo')])).toContain('banned');
    expect(codes([mon('Nonexistemon')])).toContain('unknown_pokemon');
  });

  test('tera rules: slots, tier cap, tera-banned, type count', () => {
    expect(codes([mon('Muk', { captain: true, teraTypes: ['a' as never] }), mon('Raboot', { captain: true })])).toContain('captain_count');
    expect(codes([mon('Garchomp', { captain: true })])).toContain('captain_tier');
    expect(codes([mon('Alcremie', { captain: true })])).toContain('captain_tera_banned');
    expect(codes([mon('Muk', { captain: true, teraTypes: ['dark', 'poison', 'ghost', 'fire'] })])).toContain('tera_types_over');
    // Missing tera types is informational only.
    const v = validateRoster([mon('Muk', { captain: true })], RS, lookup).violations;
    expect(v.find(x => x.code === 'captain_no_tera')?.severity).toBe('info');
  });
});

describe('draft-center sanitize', () => {
  test('bounds and coerces untrusted input', () => {
    const out = sanitizeRoster([
      { name: 'Muk', captain: true, teraTypes: ['dark', 'dark', 'bogus', 'poison', 'ghost', 'fire'],
        set: { moves: ['a', 'b', 'c', 'd', 'e'], item: 'X', ability: 'Y', nature: 'Jolly', evs: { spe: 9999 }, ivs: { atk: -4 } } },
      { name: '' }, null, 'x',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.teraTypes).toEqual(['dark', 'poison', 'ghost']);
    expect(out[0]!.set!.moves).toHaveLength(4);
    expect(sanitizeRoster([{ name: 'Muk', set: { moves: ['', 'Toxic', '', ''] } }])[0]!.set!.moves).toEqual(['', 'Toxic']);
    expect(out[0]!.set!.evs.spe).toBe(252);
    expect(out[0]!.set!.ivs.atk).toBe(0);
    expect(out[0]!.set!.ivs.spe).toBe(31);
  });
});

// Routes

const tag = `dc-${Date.now()}`;
const userIds: number[] = [];
const rulesetIds: number[] = [];
let app: Elysia;
let seasonId: number;
const leagueId = `${tag}-lg`;
let ownerCookie: string;
let otherCookie: string;

function mkUser(name: string): { id: number; cookie: string } {
  const u = db.insert(schema.users).values({
    username: `${tag}-${name}`, passwordHash: 'x', role: 'user', mustChangePassword: false, active: true,
    displayName: `${name} Display`, primaryColor: '#ff8a3d',
  }).returning().get();
  userIds.push(u.id);
  return { id: u.id, cookie: `session=${createSession(u.id)}` };
}

function hit(method: string, path: string, cookie?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.handle(new Request(`http://localhost${path}`, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
}

beforeAll(() => {
  app = new Elysia()
    .derive(({ request }) => {
      const token = parseSessionToken(request.headers.get('cookie') ?? undefined);
      return { user: token ? validateSession(token) : null, sessionToken: token };
    })
    .use(draftCenterRoutes);
  ownerCookie = mkUser('owner').cookie;
  otherCookie = mkUser('other').cookie;
  seasonId = db.insert(schema.seasons).values({ seasonNumber: 991, pointCap: 99, teraCaptainSlots: 3 }).returning().get().id;
  db.insert(schema.leagues).values({
    id: leagueId, name: 'Topaz League', color: '#fa0', seasonId, rosterSize: 8, costFormat: 'natdex',
  }).run();
});

afterAll(() => {
  try {
    for (const id of userIds) {
      db.delete(schema.draftCenterTeams).where(eq(schema.draftCenterTeams.userId, id)).run();
      db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
      db.delete(schema.users).where(eq(schema.users.id, id)).run();
    }
    db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
    for (const id of rulesetIds) db.delete(schema.rulesets).where(eq(schema.rulesets.id, id)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
  } catch { /* DB may be closed during teardown */ }
});

describe('draft-center ruleset resolver', () => {
  test('derives from a league; unknown league falls back to the default', () => {
    const rs = resolveRuleset(leagueId);
    expect(rs).toMatchObject({ pointCap: 99, rosterSize: 8, teraCaptainSlots: 3, costFormat: 'natdex', leagueId });
    expect(rs.label).toBe('Topaz League (derived)');
    expect(resolveRuleset('nope')).toBe(DEFAULT_RULESET);
    expect(resolveRuleset(null)).toBe(DEFAULT_RULESET);
  });
});

describe('draft-center routes', () => {
  let id: string;

  test('teams attach by ruleset_id; league-only teams get their league ruleset', async () => {
    const rs = db.insert(schema.rulesets).values({
      name: `${tag}-rs`, isTemplate: true, costFormat: 'natdex', pointCap: 70, rosterSize: 6,
      teraCaptainSlots: 1, teraMarkup: JSON.stringify({ 9: 12 }),
    }).returning().get();
    rulesetIds.push(rs.id);
    const a = await (await hit('POST', '/api/draft-center/teams', ownerCookie, { name: 'RS', rulesetId: rs.id })).json() as any;
    expect(a.rulesetId).toBe(rs.id);
    expect(a.ruleset).toMatchObject({ pointCap: 70, rosterSize: 6, costFormat: 'natdex' });
    expect(a.validation.budget).toBe(70);
    const bad = await (await hit('POST', '/api/draft-center/teams', ownerCookie, { name: 'X', rulesetId: 999999 })).json() as any;
    expect(bad.rulesetId).toBeNull();
    const lgTeam = await (await hit('POST', '/api/draft-center/teams', ownerCookie, { name: 'L', leagueId })).json() as any;
    expect(lgTeam.validation.budget).toBe(99); // derived league ruleset
    const moved = await (await hit('PUT', `/api/draft-center/teams/${a.id}`, ownerCookie, { rulesetId: null })).json() as any;
    expect(moved.rulesetId).toBeNull();
    expect(moved.validation.budget).toBe(110); // default
    // Picking "Default" on a league-keyed team must not snap back to the league ruleset.
    const toDefault = await (await hit('PUT', `/api/draft-center/teams/${lgTeam.id}`, ownerCookie, { rulesetId: null, leagueId: null })).json() as any;
    expect(toDefault.leagueId).toBeNull();
    expect(toDefault.rulesetId).toBeNull();
    expect(toDefault.validation.budget).toBe(110);
    for (const t of [a, bad, lgTeam]) await hit('DELETE', `/api/draft-center/teams/${t.id}`, ownerCookie);
  });

  test('public ruleset list: live templates, never archived ones', async () => {
    const live = db.insert(schema.rulesets).values({
      name: `${tag}-pub`, isTemplate: true, costFormat: 'natdex', pointCap: 90, rosterSize: 10,
      teraCaptainSlots: 2, teraMarkup: JSON.stringify({ 9: 12 }),
    }).returning().get();
    const gone = db.insert(schema.rulesets).values({
      name: `${tag}-old`, isTemplate: true, costFormat: 'natdex', pointCap: 90, rosterSize: 10,
      teraCaptainSlots: 2, teraMarkup: JSON.stringify({ 9: 12 }), archived: true,
    }).returning().get();
    rulesetIds.push(live.id, gone.id);
    const res = await hit('GET', '/api/draft-center/rulesets');
    expect(res.status).toBe(200);
    const list = await res.json() as any[];
    expect(list.find(r => r.id === live.id)).toMatchObject({ pointCap: 90, isTemplate: true });
    expect(list.some(r => r.id === gone.id)).toBe(false);
  });

  test('requires auth', async () => {
    expect((await hit('GET', '/api/draft-center/teams')).status).toBe(401);
    expect((await hit('POST', '/api/draft-center/teams', undefined, {})).status).toBe(401);
  });

  test('create / read / update / list', async () => {
    const res = await hit('POST', '/api/draft-center/teams', ownerCookie, {
      name: 'Prep A', leagueId, roster: [{ name: 'Garchomp', captain: false, teraTypes: [] }],
    });
    expect(res.status).toBe(200);
    const t = await res.json() as any;
    id = t.id;
    expect(t.leagueId).toBe(leagueId);
    expect(t.shareToken).toBeNull();
    expect(t.validation.budget).toBe(99);

    const put = await hit('PUT', `/api/draft-center/teams/${id}`, ownerCookie, {
      name: 'Renamed', roster: [{ name: 'Muk', captain: true, teraTypes: ['dark'] }], leagueId: 'does-not-exist',
    });
    const u = await put.json() as any;
    expect(u.name).toBe('Renamed');
    expect(u.leagueId).toBeNull(); // unknown league is dropped, never trusted
    expect(u.roster[0].name).toBe('Muk');

    const list = await (await hit('GET', '/api/draft-center/teams', ownerCookie)).json() as any[];
    expect(list.map(x => x.id)).toContain(id);
  });

  test('another user cannot read, edit, delete, duplicate or share it', async () => {
    for (const [m, p, b] of [
      ['GET', `/api/draft-center/teams/${id}`, undefined],
      ['PUT', `/api/draft-center/teams/${id}`, { name: 'hax' }],
      ['DELETE', `/api/draft-center/teams/${id}`, undefined],
      ['POST', `/api/draft-center/teams/${id}/duplicate`, {}],
      ['POST', `/api/draft-center/teams/${id}/share`, { enabled: true }],
    ] as const) {
      expect((await hit(m, p, otherCookie, b)).status).toBe(404);
    }
    const mine = await (await hit('GET', '/api/draft-center/teams', otherCookie)).json() as any[];
    expect(mine.find(x => x.id === id)).toBeUndefined();
    expect((await (await hit('GET', `/api/draft-center/teams/${id}`, ownerCookie)).json() as any).name).toBe('Renamed');
  });

  test('duplicate copies roster, stays private', async () => {
    await hit('POST', `/api/draft-center/teams/${id}/share`, ownerCookie, { enabled: true });
    const d = await (await hit('POST', `/api/draft-center/teams/${id}/duplicate`, ownerCookie, {})).json() as any;
    expect(d.id).not.toBe(id);
    expect(d.name).toBe('Renamed (copy)');
    expect(d.roster).toHaveLength(1);
    expect(d.shareToken).toBeNull();
    await hit('POST', `/api/draft-center/teams/${id}/share`, ownerCookie, { enabled: false });
  });

  test('share token: public read only while shared; revoke kills it', async () => {
    expect((await hit('GET', '/api/draft-center/shared/not-a-token')).status).toBe(404);

    // Private team: no token to guess, nothing public.
    const before = await (await hit('GET', `/api/draft-center/teams/${id}`, ownerCookie)).json() as any;
    expect(before.shareToken).toBeNull();

    const shared = await (await hit('POST', `/api/draft-center/teams/${id}/share`, ownerCookie, { enabled: true })).json() as any;
    const token = shared.shareToken as string;
    expect(token.length).toBeGreaterThanOrEqual(20);

    const pub = await hit('GET', `/api/draft-center/shared/${token}`); // no cookie
    expect(pub.status).toBe(200);
    const body = await pub.json() as any;
    expect(body.name).toBe('Renamed');
    expect(body.owner.displayName).toBe('owner Display');
    expect(body.id).toBeUndefined();
    expect(body.owner.passwordHash).toBeUndefined();

    // Re-enabling keeps the same link.
    const again = await (await hit('POST', `/api/draft-center/teams/${id}/share`, ownerCookie, { enabled: true })).json() as any;
    expect(again.shareToken).toBe(token);

    const embed = await hit('GET', `/api/draft-center/shared/${token}/embed`);
    expect(embed.status).toBe(200);
    const html = await embed.text();
    expect(html).toContain('og:title');
    expect(html).toContain(`/api/draft-center/shared/${token}/og.png`);
    expect(html).toContain('Renamed');

    await hit('POST', `/api/draft-center/teams/${id}/share`, ownerCookie, { enabled: false });
    expect((await hit('GET', `/api/draft-center/shared/${token}`)).status).toBe(404);
    expect((await hit('GET', `/api/draft-center/shared/${token}/embed`)).status).toBe(404);
    expect((await hit('GET', `/api/draft-center/shared/${token}/og.png`)).status).toBe(404);
  });

  test('import bulk-creates teams for the caller', async () => {
    const res = await (await hit('POST', '/api/draft-center/import', otherCookie, {
      teams: [{ name: 'Local 1', roster: [{ name: 'Muk' }] }, { name: 'Local 2', roster: [] }],
    })).json() as any;
    expect(res.imported).toBe(2);
    const mine = await (await hit('GET', '/api/draft-center/teams', otherCookie)).json() as any[];
    expect(mine.map(t => t.name).sort()).toEqual(['Local 1', 'Local 2']);
    expect((await hit('POST', '/api/draft-center/import', otherCookie, { teams: 'x' })).status).toBe(400);
  });

  test('delete', async () => {
    expect((await (await hit('DELETE', `/api/draft-center/teams/${id}`, ownerCookie)).json() as any).success).toBe(true);
    expect((await hit('GET', `/api/draft-center/teams/${id}`, ownerCookie)).status).toBe(404);
  });
});

describe('draft-center og card', () => {
  test('svg escapes team text', async () => {
    const svg = await buildCardSvg({
      teamName: 'A <b>&</b>', coachName: 'c', coachColor: 'javascript:1', subtitle: 's', roster: [],
    });
    expect(svg).toContain('A &lt;b&gt;&amp;&lt;/b&gt;');
    expect(svg).not.toContain('javascript:1'); // non-hex color rejected
  });
});
