/**
 * Pin / achievement endpoints.
 *
 *   Public:
 *     GET    /api/users/:username/pins          — pins held by a user's teams
 *                                                  (published only; spoiler-gated)
 *     GET    /api/pin-definitions                — public badge catalog
 *
 *   Admin (definitions, revoke, legacy fixtures):
 *     GET/POST /api/admin/pin-definitions, PATCH /api/admin/pin-definitions/:id
 *     DELETE /api/admin/pins/:id                 — revoke one awarded pin
 *     GET    /api/admin/pins/recent              — recently-awarded feed (?seasonId=)
 *     GET    /api/admin/pins/manual-awards/:season, POST /api/admin/pins/mint-season
 *
 *   Awards Sheet (suggest / bulk save / publish) lives in routes/pins-awards.ts.
 *
 * Awards are admin-curated: nothing here or anywhere else writes a pin
 * automatically. The holder of a pin is a TEAM (pins.team_id); the user is
 * derived at read time through teams.user_id. Unpublished drafts are visible
 * to staff only.
 */
import { Elysia } from 'elysia';
import { db, schema, sqlite } from '../db';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { checkSeasonArchived } from '../lib/archive-guard';
import { isMatchRevealed } from '../lib/queries';
import {
  PIN_SCOPES, checkMetadataFields, serializeDef, type PinScope,
} from '../lib/pins/defs';
import {
  S9_AWARDS, S10_AWARDS, mintManualPins, type ManualAward,
} from '../lib/pins/awards-data';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const VALID_CATEGORIES = ['career', 'season', 'week', 'draft', 'community', 'custom'] as const;
type Category = (typeof VALID_CATEGORIES)[number];

/** Match-referencing metadata fields that trivially reveal a result (score,
 *  standing shakeup, K/D). Stripped for non-staff viewers when the match they
 *  reference is beyond the owning league's results-reveal gate. */
const SPOILER_METADATA_KEYS = ['matchId', 'scoreLine', 'winnerRank', 'loserRank', 'kills', 'deaths'] as const;

export const pinRoutes = new Elysia()

  // GET /api/users/:username/pins (public)
  .get('/api/users/:username/pins', ({ params, user: viewer, set }) => {
    const username = params.username.toLowerCase().trim();
    if (username === 'me') { set.status = 404; return { error: 'Not found' }; }
    const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    if (!user || !user.active) { set.status = 404; return { error: 'User not found' }; }

    // A pin IS a result. "Flawless" naming the winning team gives away an
    // unrevealed week just as surely as the scoreline does, so stripping
    // spoiler fields is not enough — the whole pin stays hidden until its
    // match is revealed. Staff bypass the gate, and so does the owner, who
    // played the match and already knows how it went.
    const isOwner = viewer?.id != null && parseInt(String(viewer.id)) === user.id;
    // The holder is the TEAM; a pin shows on the coach who owns that team now
    // (legacy team-less rows fall back to pins.user_id).
    return publicPins(
      sql`COALESCE(${schema.teams.userId}, ${schema.pins.userId}) = ${user.id}`,
      viewer, isOwner,
    );
  })

  // GET /api/teams/:teamId/pins (public) — a team's published pins. Works for
  // unlinked teams too, which the per-user endpoint cannot serve.
  .get('/api/teams/:teamId/pins', ({ params, user: viewer, set }) => {
    const team = db.select({ userId: schema.teams.userId }).from(schema.teams)
      .where(eq(schema.teams.id, params.teamId)).get();
    if (!team) { set.status = 404; return { error: 'Team not found' }; }
    const isOwner = viewer?.id != null && team.userId != null && parseInt(String(viewer.id)) === team.userId;
    return publicPins(eq(schema.pins.teamId, params.teamId), viewer, isOwner);
  })

  // GET /api/pin-definitions (public badge catalog — no auth)
  // Lets a normal user browse what badges exist / how to earn them.
  // Deliberately a NARROWER shape than the admin listing (no createdAt).
  .get('/api/pin-definitions', () => {
    return db.select({
      id: schema.pinDefinitions.id,
      name: schema.pinDefinitions.name,
      description: schema.pinDefinitions.description,
      iconName: schema.pinDefinitions.iconName,
      color: schema.pinDefinitions.color,
      category: schema.pinDefinitions.category,
      isAuto: schema.pinDefinitions.isAuto,
      scope: schema.pinDefinitions.scope,
      metadataFields: schema.pinDefinitions.metadataFields,
    }).from(schema.pinDefinitions)
      .orderBy(asc(schema.pinDefinitions.category), asc(schema.pinDefinitions.name))
      .all().map(serializeDef);
  })

  // GET /api/admin/pin-definitions
  .get('/api/admin/pin-definitions', ({ user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    return db.select().from(schema.pinDefinitions)
      .orderBy(asc(schema.pinDefinitions.category), asc(schema.pinDefinitions.name))
      .all().map(serializeDef);
  })

  // POST /api/admin/pin-definitions
  .post('/api/admin/pin-definitions', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = body as Partial<{
      id: string; name: string; description: string;
      iconName: string; color: string; category: string;
      scope: string; metadataFields: unknown;
    }>;
    const id = (b.id ?? '').trim().toLowerCase();
    const name = (b.name ?? '').trim();
    const iconName = (b.iconName ?? 'Award').trim();
    const color = (b.color ?? '#fbbf24').trim();
    const category = (b.category ?? 'custom') as Category;
    const description = (b.description ?? '').trim();

    if (!SLUG_RE.test(id)) {
      set.status = 400;
      return { error: 'id must be a kebab-case slug (lowercase letters/digits/hyphen, max 64 chars)' };
    }
    if (!name) { set.status = 400; return { error: 'name required' }; }
    if (!HEX_RE.test(color)) { set.status = 400; return { error: 'color must be #RRGGBB' }; }
    if (!VALID_CATEGORIES.includes(category)) {
      set.status = 400;
      return { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` };
    }

    const scope = (b.scope ?? 'league') as PinScope;
    if (!PIN_SCOPES.includes(scope)) {
      set.status = 400;
      return { error: `scope must be one of: ${PIN_SCOPES.join(', ')}` };
    }
    const fields = checkMetadataFields(b.metadataFields ?? []);
    if ('error' in fields) { set.status = 400; return { error: fields.error }; }

    const dup = db.select().from(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, id)).get();
    if (dup) { set.status = 409; return { error: `Pin definition '${id}' already exists` }; }

    db.insert(schema.pinDefinitions).values({
      id, name, description, iconName, color, category, isAuto: false,
      scope, metadataFields: JSON.stringify(fields.fields),
    }).run();

    db.insert(schema.activityLog).values({
      type: 'pin_def_created',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Created pin definition '${id}' (${name})`,
      metadata: JSON.stringify({ id, name, category, iconName, color }),
    }).run();

    return { success: true, id };
  })

  // PATCH /api/admin/pin-definitions/:id
  .patch('/api/admin/pin-definitions/:id', ({ params, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const existing = db.select().from(schema.pinDefinitions)
      .where(eq(schema.pinDefinitions.id, params.id)).get();
    if (!existing) { set.status = 404; return { error: 'Pin definition not found' }; }

    const b = body as Partial<{
      name: string; description: string;
      iconName: string; color: string; category: string;
      scope: string; metadataFields: unknown;
    }>;
    const updates: Record<string, unknown> = {};
    if (b.scope !== undefined) {
      if (!PIN_SCOPES.includes(b.scope as PinScope)) {
        set.status = 400;
        return { error: `scope must be one of: ${PIN_SCOPES.join(', ')}` };
      }
      updates.scope = b.scope;
    }
    if (b.metadataFields !== undefined) {
      const fields = checkMetadataFields(b.metadataFields);
      if ('error' in fields) { set.status = 400; return { error: fields.error }; }
      updates.metadataFields = JSON.stringify(fields.fields);
    }

    if (b.name !== undefined) {
      const v = b.name.trim();
      if (!v) { set.status = 400; return { error: 'name cannot be empty' }; }
      updates.name = v;
    }
    if (b.description !== undefined) updates.description = b.description.trim();
    if (b.iconName !== undefined) {
      const v = b.iconName.trim();
      if (!v) { set.status = 400; return { error: 'iconName cannot be empty' }; }
      updates.iconName = v;
    }
    if (b.color !== undefined) {
      if (!HEX_RE.test(b.color)) { set.status = 400; return { error: 'color must be #RRGGBB' }; }
      updates.color = b.color;
    }
    if (b.category !== undefined) {
      if (!VALID_CATEGORIES.includes(b.category as Category)) {
        set.status = 400;
        return { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` };
      }
      updates.category = b.category;
    }

    if (Object.keys(updates).length === 0) return { success: true };

    db.update(schema.pinDefinitions).set(updates).where(eq(schema.pinDefinitions.id, params.id)).run();

    db.insert(schema.activityLog).values({
      type: 'pin_def_updated',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Updated pin definition '${params.id}'`,
      metadata: JSON.stringify({ id: params.id, updates }),
    }).run();

    return { success: true };
  })

  // DELETE /api/admin/pins/:id
  .delete('/api/admin/pins/:id', ({ params, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) { set.status = 400; return { error: 'Invalid pin id' }; }
    const existing = db.select().from(schema.pins).where(eq(schema.pins.id, id)).get();
    if (!existing) { set.status = 404; return { error: 'Pin not found' }; }

    if (existing.seasonId != null) {
      const archived = checkSeasonArchived(existing.seasonId, query.force);
      if (archived) { set.status = 409; return archived; }
    }

    const holderTeam = existing.teamId
      ? db.select({ name: schema.teams.teamName }).from(schema.teams).where(eq(schema.teams.id, existing.teamId)).get()
      : null;
    const def = db.select().from(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, existing.pinDefId)).get();

    db.delete(schema.pins).where(eq(schema.pins.id, id)).run();

    db.insert(schema.activityLog).values({
      type: 'pin_revoked',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Revoked '${def?.name ?? existing.pinDefId}' from ${holderTeam?.name ?? existing.teamId ?? 'user#' + existing.userId}`,
      metadata: JSON.stringify({
        pinId: id,
        teamId: existing.teamId,
        userId: existing.userId,
        pinDefId: existing.pinDefId,
        seasonId: existing.seasonId,
      }),
    }).run();

    return { success: true };
  })

  // GET /api/admin/pins/recent (for admin UI's recently-awarded list)
  // ?seasonId= scopes the query server-side. Without it, live is already past
  // the 200-row cap: older seasons fall off a global desc(id) ordering and the
  // admin UI (which derives ALL its state from this one fetch) reads that as
  // "no existing awards" — exactly where the Edit/override affordance is
  // needed most. The unfiltered call keeps its historical cap behaviour.
  .get('/api/admin/pins/recent', ({ query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const limit = Math.min(Math.max(parseInt(String(query?.limit ?? 50)) || 50, 1), 200);
    const seasonIdRaw = query?.seasonId;
    const seasonId = seasonIdRaw != null && seasonIdRaw !== '' ? parseInt(String(seasonIdRaw)) : null;
    const rows = db.select({
      id: schema.pins.id,
      teamId: schema.pins.teamId,
      teamName: schema.teams.teamName,
      username: schema.users.username,
      pinDefId: schema.pins.pinDefId,
      defName: schema.pinDefinitions.name,
      defIconName: schema.pinDefinitions.iconName,
      defColor: schema.pinDefinitions.color,
      seasonId: schema.pins.seasonId,
      leagueId: schema.pins.leagueId,
      published: schema.pins.published,
      source: schema.pins.source,
      awardedAt: schema.pins.awardedAt,
      awardedBy: schema.pins.awardedBy,
      metadata: schema.pins.metadata,
    })
      .from(schema.pins)
      .innerJoin(schema.pinDefinitions, eq(schema.pinDefinitions.id, schema.pins.pinDefId))
      .leftJoin(schema.teams, eq(schema.teams.id, schema.pins.teamId))
      .leftJoin(schema.users, eq(schema.users.id, sql`COALESCE(${schema.teams.userId}, ${schema.pins.userId})`))
      .where(seasonId != null && Number.isFinite(seasonId) ? eq(schema.pins.seasonId, seasonId) : undefined)
      .orderBy(desc(schema.pins.id))
      .limit(limit)
      .all();
    return rows.map(r => ({ ...r, metadata: r.metadata ? safeJson(r.metadata) : null }));
  })

  // GET /api/admin/pins/manual-awards/:season
  // Surface the per-season hand-curated award list (the same data the seed
  // job mints from) so the admin Bulk-Mint Wizard can render a preview
  // before committing. Returns the raw rows from awards-data.ts; the wizard
  // may render them grouped by pin.
  .get('/api/admin/pins/manual-awards/:season', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const season = parseInt(params.season);
    if (!Number.isFinite(season)) { set.status = 400; return { error: 'Invalid season' }; }
    const awards = manualAwardsForSeason(season);
    if (!awards) { set.status = 404; return { error: `No manual award list for S${season}` }; }
    return { season, awards };
  })

  // POST /api/admin/pins/mint-season
  // Re-run mintManualPins for a hand-curated season. Idempotent: existing
  // pins survive the (user, def, season) unique index. Returns the
  // ManualMintSummary so the wizard can show inserted/skipped/unresolved
  // counts.
  .post('/api/admin/pins/mint-season', ({ body, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = body as { season: number };
    if (!Number.isFinite(b?.season)) {
      set.status = 400;
      return { error: 'season is required' };
    }
    const awards = manualAwardsForSeason(b.season);
    if (!awards) {
      set.status = 404;
      return { error: `No manual award list for S${b.season}` };
    }

    // Both S9 and S10 (the only seasons with a manual-award list) are
    // archived — same guard every other pin mutation in this file uses.
    const seasonRow = db.select({ id: schema.seasons.id }).from(schema.seasons)
      .where(eq(schema.seasons.seasonNumber, b.season)).get();
    if (seasonRow) {
      const archived = checkSeasonArchived(seasonRow.id, query.force);
      if (archived) { set.status = 409; return archived; }
    }

    const adminId = user.id ? parseInt(user.id) : null;
    const summary = mintManualPins(sqlite, b.season, awards, adminId);

    db.insert(schema.activityLog).values({
      type: 'pin_awarded',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Bulk-minted S${b.season} awards (${summary.inserted} new, ${summary.skipped} skipped)`,
      metadata: JSON.stringify({
        bulkMint: true,
        season: b.season,
        inserted: summary.inserted,
        skipped: summary.skipped,
        unresolved: summary.unresolved.length,
      }),
    }).run();

    return { success: true, ...summary };
  });

/** Pins matching `where`, newest first, shaped for the public API: drafts are
 *  staff-only and pins pointing at an unrevealed match are hidden for
 *  everyone but staff and `ownerBypass` (the coach who played it). */
function publicPins(
  where: ReturnType<typeof sql>,
  viewer: { id?: string | number; role: string } | null | undefined,
  ownerBypass: boolean,
) {
  const staffViewer = isStaff(viewer);
  const rows = db.select({
    id: schema.pins.id,
    pinDefId: schema.pins.pinDefId,
    teamId: schema.pins.teamId,
    seasonId: schema.pins.seasonId,
    seasonNumber: schema.seasons.seasonNumber,
    leagueId: schema.pins.leagueId,
    published: schema.pins.published,
    source: schema.pins.source,
    awardedAt: schema.pins.awardedAt,
    awardedBy: schema.pins.awardedBy,
    metadata: schema.pins.metadata,
    defName: schema.pinDefinitions.name,
    defDescription: schema.pinDefinitions.description,
    defIconName: schema.pinDefinitions.iconName,
    defColor: schema.pinDefinitions.color,
    defCategory: schema.pinDefinitions.category,
    defIsAuto: schema.pinDefinitions.isAuto,
    defScope: schema.pinDefinitions.scope,
    defFields: schema.pinDefinitions.metadataFields,
  })
    .from(schema.pins)
    .innerJoin(schema.pinDefinitions, eq(schema.pinDefinitions.id, schema.pins.pinDefId))
    .leftJoin(schema.teams, eq(schema.teams.id, schema.pins.teamId))
    .leftJoin(schema.seasons, eq(schema.seasons.id, schema.pins.seasonId))
    .where(and(where, staffViewer ? undefined : eq(schema.pins.published, true)))
    .orderBy(desc(schema.pins.awardedAt))
    .all();

  const bypassGate = ownerBypass || staffViewer;
  return rows
    .map(r => ({ ...r, meta: r.metadata ? safeJson(r.metadata) as Record<string, unknown> | null : null }))
    .filter(r => bypassGate || !referencesUnrevealedMatch(r.meta, viewer))
    .map(r => ({
      id: r.id,
      pinDefId: r.pinDefId,
      teamId: r.teamId,
      seasonId: r.seasonId,
      seasonNumber: r.seasonNumber,
      leagueId: r.leagueId,
      published: r.published,
      source: r.source,
      awardedAt: r.awardedAt,
      awardedBy: r.awardedBy,
      metadata: bypassGate ? r.meta : redactUnrevealedMetadata(r.meta, viewer),
      definition: {
        id: r.pinDefId,
        name: r.defName,
        description: r.defDescription,
        iconName: r.defIconName,
        color: r.defColor,
        category: r.defCategory,
        isAuto: r.defIsAuto,
        scope: r.defScope,
        metadataFields: serializeDef({ metadataFields: r.defFields }).metadataFields,
      },
    }));
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Look up the hand-curated award list for a given season number. The seed
 *  ships fixtures for S9 and S10; future seasons can be added here when
 *  their manual awards lands in `lib/pins/awards-data.ts`. */
function manualAwardsForSeason(season: number): ManualAward[] | null {
  if (season === 9) return S9_AWARDS;
  if (season === 10) return S10_AWARDS;
  return null;
}

/**
 * True when this pin points at a match the viewer isn't allowed to see yet.
 * Kingslayer/Flawless carry `metadata.matchId` (see lib/pins/auto-award.ts), so
 * resolving it to the match's leagueId/week reuses the exact `isMatchRevealed`
 * gate routes/matches.ts already applies (commit 48d5124) rather than inventing
 * a parallel one. Callers drop the whole pin when this is true.
 */
function referencesUnrevealedMatch(
  metadata: Record<string, unknown> | null,
  viewer: { role: string } | null | undefined,
): boolean {
  if (!metadata || typeof metadata.matchId !== 'string') return false;
  const match = db.select({ leagueId: schema.matches.leagueId, week: schema.matches.week })
    .from(schema.matches)
    .where(eq(schema.matches.id, metadata.matchId))
    .get();
  return !!match && !isMatchRevealed(match, viewer);
}

/**
 * Field-level backstop for the same gate. The list endpoint already drops
 * unrevealed pins outright, so this only fires for viewers who bypass the gate
 * or for metadata that leaks a result without a resolvable `matchId` — keep it
 * as defence in depth rather than the primary control.
 */
function redactUnrevealedMetadata(
  metadata: Record<string, unknown> | null,
  viewer: { role: string } | null | undefined,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata.matchId !== 'string') return metadata;
  const match = db.select({ leagueId: schema.matches.leagueId, week: schema.matches.week })
    .from(schema.matches)
    .where(eq(schema.matches.id, metadata.matchId))
    .get();
  if (!match || isMatchRevealed(match, viewer)) return metadata;

  const redacted = { ...metadata };
  for (const key of SPOILER_METADATA_KEYS) delete redacted[key];
  return redacted;
}
