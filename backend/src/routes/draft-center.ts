/**
 * Draft Center — per-user planner teams.
 *
 *   Authenticated (owner-scoped; mutations are CSRF-guarded by the root app):
 *     GET    /api/draft-center/teams
 *     POST   /api/draft-center/teams                 { name?, leagueId?, roster? }
 *     GET    /api/draft-center/teams/:id
 *     PUT    /api/draft-center/teams/:id             { name?, leagueId?, roster? }
 *     DELETE /api/draft-center/teams/:id
 *     POST   /api/draft-center/teams/:id/duplicate
 *     POST   /api/draft-center/teams/:id/share       { enabled }   (issues / revokes the token)
 *     POST   /api/draft-center/import                { teams: [...] }  (guest localStorage → account)
 *
 *   Public (token-addressed, only while the team is shared):
 *     GET    /api/draft-center/shared/:token         read-only team + coach identity
 *     GET    /api/draft-center/shared/:token/og.png  share-card image
 *     GET    /api/draft-center/shared/:token/embed   HTML with OG meta (crawlers)
 *
 * Another user's private team is indistinguishable from a missing one (404).
 */

import { Elysia } from 'elysia';
import { randomBytes, randomUUID } from 'crypto';
import { db, schema } from '../db';
import { and, eq, desc, sql } from 'drizzle-orm';
import {
  sanitizeRoster, sanitizeName, MAX_TEAMS_PER_USER, type DcMon,
} from '../lib/draft-center/types';
import { resolveTeamRuleset, validateForRuleset } from '../lib/draft-center/rules';
import { rowToRuleset, rulesetUsage } from '../lib/rulesets';
import { cachedCardPng, xmlEscape } from '../lib/draft-center/og-image';

type Row = typeof schema.draftCenterTeams.$inferSelect;

const parseRoster = (raw: string): DcMon[] => {
  try { return sanitizeRoster(JSON.parse(raw)); } catch { return []; }
};

const knownRuleset = (id: unknown): number | null =>
  Number.isInteger(id) && db.select({ id: schema.rulesets.id }).from(schema.rulesets).where(eq(schema.rulesets.id, id as number)).get()
    ? id as number : null;

/** rulesetId wins; a bare leagueId (legacy clients) attaches that league's ruleset. */
const rulesetFor = (rulesetId: unknown, leagueId: string | null): number | null =>
  knownRuleset(rulesetId)
  ?? (leagueId ? db.select({ r: schema.leagues.rulesetId }).from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get()?.r ?? null : null);

const knownLeague = (id: unknown): string | null =>
  typeof id === 'string' && id
    && db.select({ id: schema.leagues.id }).from(schema.leagues).where(eq(schema.leagues.id, id)).get()
    ? id : null;

function toDto(row: Row) {
  const roster = parseRoster(row.roster);
  const rs = resolveTeamRuleset(row);
  return {
    id: row.id,
    name: row.name,
    leagueId: row.leagueId,
    rulesetId: row.rulesetId ?? null,
    ruleset: rs,
    roster,
    shareToken: row.shareToken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rulesetLabel: rs.label,
    validation: validateForRuleset(roster, rs),
  };
}

function ownerOf(userId: number) {
  const u = db.select({
    username: schema.users.username,
    displayName: schema.users.displayName,
    primaryColor: schema.users.primaryColor,
  }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return { username: u?.username ?? 'unknown', displayName: u?.displayName ?? null, primaryColor: u?.primaryColor ?? null };
}

function sharedRow(token: string): Row | undefined {
  if (!token || token.length > 64) return undefined;
  return db.select().from(schema.draftCenterTeams)
    .where(eq(schema.draftCenterTeams.shareToken, token)).get();
}

function ownedRow(userId: number, id: string): Row | undefined {
  return db.select().from(schema.draftCenterTeams)
    .where(and(eq(schema.draftCenterTeams.id, id), eq(schema.draftCenterTeams.userId, userId))).get();
}

const teamCount = (userId: number): number =>
  db.select({ n: sql<number>`COUNT(*)` }).from(schema.draftCenterTeams)
    .where(eq(schema.draftCenterTeams.userId, userId)).get()?.n ?? 0;

function insertTeam(userId: number, name: string, leagueId: string | null, rulesetId: number | null, roster: DcMon[]): Row {
  return db.insert(schema.draftCenterTeams).values({
    id: randomUUID(), userId, name, leagueId, rulesetId, roster: JSON.stringify(roster),
  }).returning().get();
}

const touch = sql`(datetime('now'))`;

/** Public origin for absolute OG URLs: explicit env, else the proxy's headers. */
function originOf(request: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const h = request.headers;
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function cardFor(row: Row) {
  const dto = toDto(row);
  const owner = ownerOf(row.userId);
  return {
    dto, owner,
    card: {
      teamName: row.name,
      coachName: owner.displayName || owner.username,
      coachColor: owner.primaryColor,
      subtitle: `${dto.rulesetLabel} · ${dto.validation.used}/${dto.validation.budget} pts`,
      roster: dto.roster,
    },
  };
}

type Ctx = { user: { id: string } | null; set: { status?: number | string } };
const authed = ({ user, set }: Ctx): number | null => {
  if (!user) { set.status = 401; return null; }
  return parseInt(user.id);
};
const notFound = (set: Ctx['set']) => { set.status = 404; return { error: 'Team not found' }; };

export const draftCenterRoutes = new Elysia()

  // Public: rulesets a planner may pick — live templates plus the instances
  // used by leagues in unarchived seasons (no auth; rules aren't private).
  .get('/api/draft-center/rulesets', () => {
    const active = new Set(db.select({ id: schema.leagues.rulesetId }).from(schema.leagues)
      .innerJoin(schema.seasons, eq(schema.leagues.seasonId, schema.seasons.id))
      .where(eq(schema.seasons.archived, false)).all().map(r => r.id).filter((id): id is number => id != null));
    return db.select().from(schema.rulesets).where(eq(schema.rulesets.archived, false)).all()
      .filter(r => r.isTemplate || active.has(r.id))
      .map(r => {
        const usage = r.isTemplate ? null : rulesetUsage(r.id);
        return {
          ...rowToRuleset(r), description: r.description, isTemplate: r.isTemplate, archived: r.archived,
          frozen: usage?.frozen ?? false, usedBy: usage?.leagueIds ?? [],
        };
      });
  })

  .get('/api/draft-center/teams', (ctx) => {
    const uid = authed(ctx);
    if (uid == null) return { error: 'Not authenticated' };
    return db.select().from(schema.draftCenterTeams)
      .where(eq(schema.draftCenterTeams.userId, uid))
      .orderBy(desc(schema.draftCenterTeams.updatedAt)).all().map(toDto);
  })

  .post('/api/draft-center/teams', (ctx) => {
    const uid = authed(ctx);
    if (uid == null) return { error: 'Not authenticated' };
    const b = (ctx.body ?? {}) as Record<string, unknown>;
    if (teamCount(uid) >= MAX_TEAMS_PER_USER) {
      ctx.set.status = 400;
      return { error: `Team limit reached (${MAX_TEAMS_PER_USER})` };
    }
    const lg = knownLeague(b.leagueId);
    return toDto(insertTeam(uid, sanitizeName(b.name), lg, rulesetFor(b.rulesetId, lg), sanitizeRoster(b.roster)));
  })

  .get('/api/draft-center/teams/:id', (ctx) => {
    const uid = authed(ctx);
    if (uid == null) return { error: 'Not authenticated' };
    const row = ownedRow(uid, ctx.params.id);
    return row ? toDto(row) : notFound(ctx.set);
  })

  .put('/api/draft-center/teams/:id', (ctx) => {
    const uid = authed(ctx);
    if (uid == null) return { error: 'Not authenticated' };
    const row = ownedRow(uid, ctx.params.id);
    if (!row) return notFound(ctx.set);
    const b = (ctx.body ?? {}) as Record<string, unknown>;
    const patch: Partial<Row> = {};
    if (b.name !== undefined) patch.name = sanitizeName(b.name, row.name);
    if ('leagueId' in b) patch.leagueId = knownLeague(b.leagueId);
    if ('rulesetId' in b || 'leagueId' in b) {
      patch.rulesetId = rulesetFor(b.rulesetId, patch.leagueId ?? row.leagueId);
    }
    if (b.roster !== undefined) patch.roster = JSON.stringify(sanitizeRoster(b.roster));
    const updated = db.update(schema.draftCenterTeams)
      .set({ ...patch, updatedAt: touch })
      .where(eq(schema.draftCenterTeams.id, row.id)).returning().get();
    return toDto(updated);
  })

  .delete('/api/draft-center/teams/:id', (ctx) => {
    const uid = authed(ctx);
    if (uid == null) return { error: 'Not authenticated' };
    const row = ownedRow(uid, ctx.params.id);
    if (!row) return notFound(ctx.set);
    db.delete(schema.draftCenterTeams).where(eq(schema.draftCenterTeams.id, row.id)).run();
    return { success: true };
  })

  .post('/api/draft-center/teams/:id/duplicate', (ctx) => {
    const uid = authed(ctx);
    if (uid == null) return { error: 'Not authenticated' };
    const row = ownedRow(uid, ctx.params.id);
    if (!row) return notFound(ctx.set);
    if (teamCount(uid) >= MAX_TEAMS_PER_USER) {
      ctx.set.status = 400;
      return { error: `Team limit reached (${MAX_TEAMS_PER_USER})` };
    }
    // Copy is private and unshared: a fresh row never inherits the share token.
    return toDto(insertTeam(uid, sanitizeName(`${row.name} (copy)`), row.leagueId, row.rulesetId, parseRoster(row.roster)));
  })

  .post('/api/draft-center/teams/:id/share', (ctx) => {
    const uid = authed(ctx);
    if (uid == null) return { error: 'Not authenticated' };
    const row = ownedRow(uid, ctx.params.id);
    if (!row) return notFound(ctx.set);
    const enabled = (ctx.body as { enabled?: unknown } | null)?.enabled === true;
    // Keep an existing token when re-enabling an already-shared team (stable link).
    const token = enabled ? (row.shareToken ?? randomBytes(16).toString('base64url')) : null;
    const updated = db.update(schema.draftCenterTeams)
      .set({ shareToken: token })
      .where(eq(schema.draftCenterTeams.id, row.id)).returning().get();
    return toDto(updated);
  })

  .post('/api/draft-center/import', (ctx) => {
    const uid = authed(ctx);
    if (uid == null) return { error: 'Not authenticated' };
    const incoming = (ctx.body as { teams?: unknown } | null)?.teams;
    if (!Array.isArray(incoming)) { ctx.set.status = 400; return { error: 'teams must be an array' }; }
    const room = Math.max(0, MAX_TEAMS_PER_USER - teamCount(uid));
    const created = incoming.slice(0, room).map(t => {
      const r = (t ?? {}) as Record<string, unknown>;
      const lg = knownLeague(r.leagueId);
      return toDto(insertTeam(uid, sanitizeName(r.name), lg, rulesetFor(r.rulesetId, lg), sanitizeRoster(r.roster)));
    });
    return { imported: created.length, skipped: incoming.length - created.length, teams: created };
  })

  // Public share endpoints

  .get('/api/draft-center/shared/:token', ({ params, set }) => {
    const row = sharedRow(params.token);
    if (!row) { set.status = 404; return { error: 'Not found' }; }
    const dto = toDto(row);
    return {
      name: dto.name, leagueId: dto.leagueId, rulesetId: dto.rulesetId, ruleset: dto.ruleset, roster: dto.roster, updatedAt: dto.updatedAt,
      rulesetLabel: dto.rulesetLabel, validation: dto.validation, owner: ownerOf(row.userId),
    };
  })

  .get('/api/draft-center/shared/:token/og.png', async ({ params, set }) => {
    const row = sharedRow(params.token);
    if (!row) { set.status = 404; return { error: 'Not found' }; }
    try {
      const png = await cachedCardPng(`${row.shareToken}:${row.updatedAt}`, cardFor(row).card);
      return new Response(png, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' },
      });
    } catch (err) {
      console.error('[draft-center] og render failed:', err);
      set.status = 500;
      return { error: 'Image unavailable' };
    }
  })

  // HTML shell for link-preview crawlers (nginx routes bot user-agents here;
  // humans get the SPA). Carries OG/Twitter meta and bounces real browsers on.
  .get('/api/draft-center/shared/:token/embed', ({ params, request, set }) => {
    const row = sharedRow(params.token);
    if (!row) { set.status = 404; return { error: 'Not found' }; }
    const { dto, owner } = cardFor(row);
    const origin = originOf(request);
    const url = `${origin}/draft-center/s/${row.shareToken}`;
    const coach = owner.displayName || owner.username;
    const title = `${row.name} — Draft Center`;
    const names = dto.roster.map(m => m.name).join(', ');
    const desc = `${coach} · ${dto.roster.length} Pokemon · ${dto.rulesetLabel} · ${dto.validation.used}/${dto.validation.budget} pts${names ? ` — ${names}` : ''}`.slice(0, 280);
    const image = `${origin}/api/draft-center/shared/${row.shareToken}/og.png?v=${encodeURIComponent(row.updatedAt)}`;
    const e = xmlEscape;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${e(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Cannoli">
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}">
<meta property="og:url" content="${e(url)}"><meta property="og:image" content="${e(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(desc)}"><meta name="twitter:image" content="${e(image)}">
<meta name="theme-color" content="${/^#[0-9a-fA-F]{6}$/.test(owner.primaryColor ?? '') ? owner.primaryColor : '#7dd3fc'}">
<meta http-equiv="refresh" content="0;url=${e(url)}"></head><body><a href="${e(url)}">${e(title)}</a></body></html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
