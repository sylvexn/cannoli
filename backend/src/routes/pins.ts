/**
 * Pin / achievement endpoints (Slice 3).
 *
 *   Public:
 *     GET    /api/users/:username/pins          — list a user's pins (def joined,
 *                                                  spoiler-redacted for unrevealed matches)
 *     GET    /api/pin-definitions                — public badge catalog
 *
 *   Admin:
 *     GET    /api/admin/pin-definitions          — list defs
 *     POST   /api/admin/pin-definitions          — create def
 *     PATCH  /api/admin/pin-definitions/:id      — edit def
 *     POST   /api/admin/pins/award               — award pin to user
 *     PATCH  /api/admin/pins/:id                 — re-point / edit an awarded pin
 *     DELETE /api/admin/pins/:id                 — revoke awarded pin
 *     GET    /api/admin/pins/recent              — recently-awarded feed (?seasonId=)
 *     GET    /api/admin/pins/manual-awards/:season
 *     POST   /api/admin/pins/mint-season         — bulk-mint a hand-curated season
 *     POST   /api/admin/pins/run-auto            — run the stat-derived auto-award job
 *
 * Pins are append-only history. A unique index on
 * (user, def, COALESCE(season,-1), COALESCE(league,'')) means the auto-award
 * job is safe to re-run; the admin authoring path goes through the same
 * insert and surfaces a friendly error on dup.
 *
 * `source` ('auto' | 'manual') carries recompute semantics — see migration
 * 0069 and schema.ts:719. Any write through this file that represents a
 * human decision (a hand-award, or an admin edit/override of an existing
 * row) MUST set source='manual' so the minters (lib/pins/**) never delete
 * and re-derive over it. `awarded_by` is pure provenance — who did it —
 * never used to decide recomputability.
 */
import { Elysia } from 'elysia';
import { db, schema, sqlite } from '../db';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { checkSeasonArchived } from '../lib/archive-guard';
import { isMatchRevealed } from '../lib/queries';
import {
  S9_AWARDS, S10_AWARDS, mintManualPins, type ManualAward,
} from '../lib/pins/awards-data';
import { runAutoAwards } from '../lib/pins/auto-award';
import { mintArchivePins } from '../lib/pins/archive-mint';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const VALID_CATEGORIES = ['career', 'season', 'week', 'draft', 'community', 'custom'] as const;
type Category = (typeof VALID_CATEGORIES)[number];
/** category → must the pin carry a season? 'career' must NOT; season/week/draft MUST. */
const SEASON_REQUIRED_CATEGORIES: readonly Category[] = ['season', 'week', 'draft'];

/** Metadata is free-form JSON straight into a TEXT column — cap it so a
 *  fat-fingered (or malicious) admin request can't write an unbounded blob. */
const MAX_METADATA_JSON_LEN = 4000;

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

    // Join pins → pin_definitions; newest first.
    const rows = db.select({
      id: schema.pins.id,
      pinDefId: schema.pins.pinDefId,
      seasonId: schema.pins.seasonId,
      leagueId: schema.pins.leagueId,
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
    })
      .from(schema.pins)
      .innerJoin(schema.pinDefinitions, eq(schema.pinDefinitions.id, schema.pins.pinDefId))
      .where(eq(schema.pins.userId, user.id))
      .orderBy(desc(schema.pins.awardedAt))
      .all();

    // A pin IS a result. "Flawless" naming the winning team gives away an
    // unrevealed week just as surely as the scoreline does, so stripping
    // spoiler fields is not enough — the whole pin stays hidden until its
    // match is revealed. Staff bypass the gate, and so does the owner, who
    // played the match and already knows how it went.
    const isOwner = viewer?.id != null && parseInt(String(viewer.id)) === user.id;
    const bypassGate = isOwner || isStaff(viewer);

    return rows
      .map(r => ({ ...r, meta: r.metadata ? safeJson(r.metadata) as Record<string, unknown> | null : null }))
      .filter(r => bypassGate || !referencesUnrevealedMatch(r.meta, viewer))
      .map(r => ({
        id: r.id,
        pinDefId: r.pinDefId,
        seasonId: r.seasonId,
        leagueId: r.leagueId,
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
        },
      }));
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
    }).from(schema.pinDefinitions)
      .orderBy(asc(schema.pinDefinitions.category), asc(schema.pinDefinitions.name))
      .all();
  })

  // GET /api/admin/pin-definitions
  .get('/api/admin/pin-definitions', ({ user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    return db.select().from(schema.pinDefinitions)
      .orderBy(asc(schema.pinDefinitions.category), asc(schema.pinDefinitions.name))
      .all();
  })

  // POST /api/admin/pin-definitions
  .post('/api/admin/pin-definitions', ({ body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = body as Partial<{
      id: string; name: string; description: string;
      iconName: string; color: string; category: string;
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

    const dup = db.select().from(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, id)).get();
    if (dup) { set.status = 409; return { error: `Pin definition '${id}' already exists` }; }

    db.insert(schema.pinDefinitions).values({
      id, name, description, iconName, color, category, isAuto: false,
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
    }>;
    const updates: Record<string, unknown> = {};

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

  // POST /api/admin/pins/award
  .post('/api/admin/pins/award', ({ query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = body as {
      userId: number; pinDefId: string; metadata?: Record<string, unknown>;
      seasonId?: number | null; leagueId?: string | null;
    };
    if (!b.userId || !b.pinDefId) {
      set.status = 400;
      return { error: 'userId and pinDefId are required' };
    }
    if (b.seasonId != null) {
      const archived = checkSeasonArchived(b.seasonId, query.force);
      if (archived) { set.status = 409; return archived; }
    }
    const targetUser = db.select().from(schema.users).where(eq(schema.users.id, b.userId)).get();
    if (!targetUser) { set.status = 404; return { error: 'Target user not found' }; }
    const def = db.select().from(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, b.pinDefId)).get();
    if (!def) { set.status = 404; return { error: 'Pin definition not found' }; }

    // Auto-owned definitions belong to the minters — the admin UI only hides
    // the award button client-side, so this is the server-side backstop
    // against a raw API call creating a permanent duplicate they can never
    // reconcile (a `source='manual'` row under an is_auto def).
    if (def.isAuto) {
      set.status = 400;
      return { error: `'${def.id}' is an auto-awarded pin and cannot be hand-awarded` };
    }

    const scopeError = checkCategoryScope(def.category as Category, b.seasonId ?? null);
    if (scopeError) { set.status = 400; return { error: scopeError }; }

    const metadataError = checkMetadataSize(b.metadata);
    if (metadataError) { set.status = 400; return { error: metadataError }; }

    const leagueId = b.leagueId ?? null;
    if (leagueId != null) {
      const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
      if (!league) { set.status = 400; return { error: `League '${leagueId}' not found` }; }
      if (b.seasonId != null && league.seasonId !== b.seasonId) {
        set.status = 400;
        return { error: `League '${leagueId}' does not belong to season ${b.seasonId}` };
      }
      if (!findTeamInLeague(b.userId, leagueId)) {
        set.status = 400;
        return { error: `${targetUser.username} does not own a team in league '${leagueId}'` };
      }
    }

    // Use INSERT OR IGNORE so admin double-clicking the button is a no-op
    // rather than a 500 from the unique constraint.
    const seasonId = b.seasonId ?? null;
    const metadata = b.metadata ? JSON.stringify(b.metadata) : null;
    const awardedById = user.id ? parseInt(user.id) : null;

    // Insert + activity-log atomically (DEDUP-MISC): the unique index
    // `pins_identity_idx` on (user, def, COALESCE(season,-1), COALESCE(league,''))
    // makes INSERT OR IGNORE a no-op on a dupe, so changes=0 → 409 for every
    // season/league scope combination (see migration 0069).
    const out = tx(() => {
      const res = db.run(sql`
        INSERT OR IGNORE INTO pins (user_id, pin_def_id, season_id, league_id, awarded_by, source, metadata)
        VALUES (${b.userId}, ${b.pinDefId}, ${seasonId}, ${leagueId}, ${awardedById}, 'manual', ${metadata})
      `);
      const changes = (res as unknown as { changes?: number } | undefined)?.changes ?? 0;
      if (changes === 0) return { duplicate: true as const };

      const inserted = db.select().from(schema.pins)
        .where(and(
          eq(schema.pins.userId, b.userId),
          eq(schema.pins.pinDefId, b.pinDefId),
          seasonId == null
            ? sql`${schema.pins.seasonId} IS NULL`
            : eq(schema.pins.seasonId, seasonId),
          leagueId == null
            ? sql`${schema.pins.leagueId} IS NULL`
            : eq(schema.pins.leagueId, leagueId),
        ))
        .orderBy(desc(schema.pins.id))
        .get();

      db.insert(schema.activityLog).values({
        type: 'pin_awarded',
        category: 'admin',
        actor: user.username,
        leagueId,
        description: `Awarded '${def.name}' to ${targetUser.username}`,
        metadata: JSON.stringify({
          userId: b.userId,
          username: targetUser.username,
          pinDefId: b.pinDefId,
          pinName: def.name,
          seasonId,
          leagueId,
          awardedById,
        }),
      }).run();

      return { duplicate: false as const, id: inserted?.id ?? null };
    });

    if (out.duplicate) {
      set.status = 409;
      return { error: 'User already has this pin for the given season/league' };
    }

    return { success: true, id: out.id };
  })

  // PATCH /api/admin/pins/:id
  // Re-point an existing pin to a different user. Used by the admin UI to
  // override an auto-awarded pin (e.g. correcting Garchomp after a stat
  // recompute) without deleting + re-awarding. Idempotent: setting the same
  // userId is a no-op.
  .patch('/api/admin/pins/:id', ({ params, body, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) { set.status = 400; return { error: 'Invalid pin id' }; }
    const existing = db.select().from(schema.pins).where(eq(schema.pins.id, id)).get();
    if (!existing) { set.status = 404; return { error: 'Pin not found' }; }

    if (existing.seasonId != null) {
      const archived = checkSeasonArchived(existing.seasonId, query.force);
      if (archived) { set.status = 409; return archived; }
    }

    const b = body as Partial<{ userId: number; metadata: Record<string, unknown> }>;
    const updates: Record<string, unknown> = {};
    // Tracks the league_id this pin should carry after the edit — starts as
    // the current value, re-resolved below when the recipient changes.
    let newLeagueId: string | null = existing.leagueId;

    if (b.userId !== undefined) {
      const targetUser = db.select().from(schema.users).where(eq(schema.users.id, b.userId)).get();
      if (!targetUser) { set.status = 404; return { error: 'Target user not found' }; }

      // League-scoped pin: the new recipient must own a team in THAT league
      // so metadata.teamId / league_id can follow them and never point at
      // the previous owner's team.
      let recipientTeam: { id: string; leagueId: string } | undefined;
      if (existing.leagueId != null) {
        recipientTeam = findTeamInLeague(b.userId, existing.leagueId);
        if (!recipientTeam) {
          set.status = 400;
          return { error: `${targetUser.username} does not own a team in league '${existing.leagueId}'` };
        }
        newLeagueId = recipientTeam.leagueId;
      }

      // Check for collision with the unique (user, def, season, league) index.
      if (b.userId !== existing.userId) {
        const collision = db.select().from(schema.pins).where(and(
          eq(schema.pins.userId, b.userId),
          eq(schema.pins.pinDefId, existing.pinDefId),
          existing.seasonId == null
            ? sql`${schema.pins.seasonId} IS NULL`
            : eq(schema.pins.seasonId, existing.seasonId),
          newLeagueId == null
            ? sql`${schema.pins.leagueId} IS NULL`
            : eq(schema.pins.leagueId, newLeagueId),
        )).get();
        if (collision) {
          set.status = 409;
          return { error: 'Target user already has this pin for the given season/league' };
        }
      }

      updates.userId = b.userId;
      if (existing.leagueId != null) updates.leagueId = newLeagueId;

      // Refresh metadata.teamId to the new recipient's team, unless this same
      // call also writes metadata explicitly (an explicit write wins).
      if (recipientTeam && b.metadata === undefined) {
        const currentMeta = existing.metadata ? safeJson(existing.metadata) : null;
        const base = currentMeta && typeof currentMeta === 'object'
          ? currentMeta as Record<string, unknown>
          : {};
        updates.metadata = JSON.stringify({ ...base, teamId: recipientTeam.id });
      }
    }
    if (b.metadata !== undefined) {
      const metadataError = checkMetadataSize(b.metadata);
      if (metadataError) { set.status = 400; return { error: metadataError }; }
      updates.metadata = JSON.stringify(b.metadata);
    }

    if (Object.keys(updates).length === 0) return { success: true };

    // TOP BUG FIX: any successful write through this endpoint is a human
    // correction — mark it manual (+ stamp who) so the minters' next re-run
    // never deletes-and-re-derives over it. `awarded_by` used to double as
    // this flag and PATCH never touched it, so the correction silently
    // reverted on the next mint. See migration 0069 / schema.ts:719.
    updates.source = 'manual';
    updates.awardedBy = user.id ? parseInt(user.id) : null;

    db.update(schema.pins).set(updates).where(eq(schema.pins.id, id)).run();

    const def = db.select().from(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, existing.pinDefId)).get();
    const newUser = b.userId !== undefined
      ? db.select().from(schema.users).where(eq(schema.users.id, b.userId)).get()
      : null;

    db.insert(schema.activityLog).values({
      type: 'pin_awarded',
      category: 'admin',
      actor: user.username,
      leagueId: newLeagueId,
      description: `Re-pointed '${def?.name ?? existing.pinDefId}' (pin#${id})${newUser ? ` to ${newUser.username}` : ''}`,
      metadata: JSON.stringify({
        pinId: id,
        previousUserId: existing.userId,
        newUserId: b.userId ?? existing.userId,
        pinDefId: existing.pinDefId,
        seasonId: existing.seasonId,
        leagueId: newLeagueId,
        override: true,
      }),
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

    const targetUser = db.select().from(schema.users).where(eq(schema.users.id, existing.userId)).get();
    const def = db.select().from(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, existing.pinDefId)).get();

    db.delete(schema.pins).where(eq(schema.pins.id, id)).run();

    db.insert(schema.activityLog).values({
      type: 'pin_revoked',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Revoked '${def?.name ?? existing.pinDefId}' from ${targetUser?.username ?? 'user#' + existing.userId}`,
      metadata: JSON.stringify({
        pinId: id,
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
      userId: schema.pins.userId,
      username: schema.users.username,
      pinDefId: schema.pins.pinDefId,
      defName: schema.pinDefinitions.name,
      defIconName: schema.pinDefinitions.iconName,
      defColor: schema.pinDefinitions.color,
      seasonId: schema.pins.seasonId,
      awardedAt: schema.pins.awardedAt,
      awardedBy: schema.pins.awardedBy,
      metadata: schema.pins.metadata,
    })
      .from(schema.pins)
      .innerJoin(schema.users, eq(schema.users.id, schema.pins.userId))
      .innerJoin(schema.pinDefinitions, eq(schema.pinDefinitions.id, schema.pins.pinDefId))
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
  })

  // POST /api/admin/pins/run-auto
  // Run the auto-award (season-end) job for every league belonging to a
  // season. Idempotent: each insert goes through the (user, def, season)
  // unique index. Intended to be called from the admin Pins tab once the
  // season is in offseason / past finals; the UI hides the button mid-season.
  .post('/api/admin/pins/run-auto', ({ body, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = body as { season: number };
    const seasonNumber = b?.season;
    if (!Number.isFinite(seasonNumber)) {
      set.status = 400;
      return { error: 'season is required' };
    }
    const seasonRow = db.select().from(schema.seasons)
      .where(eq(schema.seasons.seasonNumber, seasonNumber)).get();
    if (!seasonRow) { set.status = 404; return { error: `Season ${seasonNumber} not found` }; }

    const archived = checkSeasonArchived(seasonRow.id, query.force);
    if (archived) { set.status = 409; return archived; }

    const leagues = db.select().from(schema.leagues)
      .where(eq(schema.leagues.seasonId, seasonRow.id)).all();

    const adminId = user.id ? parseInt(user.id) : null;
    let totalAwarded = 0;
    let totalSkipped = 0;
    const perLeague: { leagueId: string; awarded: number; skipped: number }[] = [];
    const unresolved: Record<string, unknown>[] = [];

    for (const league of leagues) {
      // Both minters, in the same order the phase→offseason route and the
      // archive ceremony use. Running only runAutoAwards here left champion /
      // high-score / steal-of-the-draft / sweeper with no re-run path at all
      // from the admin UI — this is the one button that reconciles every
      // stat-derived pin, so it has to cover all of them.
      const archive = mintArchivePins(league.id, { awardedBy: adminId });
      const summary = runAutoAwards(league.id, { trigger: 'season-end', awardedBy: adminId });
      const awarded = archive.awarded.length + summary.awarded.length;
      const skipped = archive.skipped + summary.skipped;
      totalAwarded += awarded;
      totalSkipped += skipped;
      perLeague.push({ leagueId: league.id, awarded, skipped });
      // Previously dropped on the floor. An award that cannot be minted (team
      // has no linked user, a manual pin owns the slot, no eligible matches)
      // must reach the admin — silent skips are how S9 Ruby lost its champion.
      for (const u of [...(archive.unresolved ?? []), ...(summary.unresolved ?? [])]) {
        unresolved.push({ leagueId: league.id, ...u });
      }
    }

    db.insert(schema.activityLog).values({
      type: 'pin_awarded',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Ran auto-awards for S${seasonNumber} (${totalAwarded} new, ${totalSkipped} skipped across ${leagues.length} league(s))`,
      metadata: JSON.stringify({
        autoRun: true,
        season: seasonNumber,
        leagues: perLeague,
        totalAwarded,
        totalSkipped,
        unresolved,
      }),
    }).run();

    return { success: true, season: seasonNumber, totalAwarded, totalSkipped, perLeague, unresolved };
  });

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

/** Does `userId` own a team in `leagueId`? Shared by the award + override
 *  paths — both need to resolve "the recipient's team in this league" to
 *  keep metadata.teamId / pins.league_id honest. */
function findTeamInLeague(userId: number, leagueId: string): { id: string; leagueId: string } | undefined {
  return db.select({ id: schema.teams.id, leagueId: schema.teams.leagueId })
    .from(schema.teams)
    .where(and(eq(schema.teams.userId, userId), eq(schema.teams.leagueId, leagueId)))
    .get();
}

/** Scope coherence: 'career' pins are NOT season-scoped; 'season'/'week'/
 *  'draft' pins MUST be. Returns an error string, or null when ok. */
function checkCategoryScope(category: Category, seasonId: number | null): string | null {
  if (category === 'career' && seasonId != null) {
    return `'career' pins must not have a season (got season ${seasonId})`;
  }
  if (SEASON_REQUIRED_CATEGORIES.includes(category) && seasonId == null) {
    return `'${category}' pins require a season`;
  }
  return null;
}

/** Reject metadata that would write an unbounded blob into the TEXT column.
 *  Returns an error string, or null when ok (including "no metadata"). */
function checkMetadataSize(metadata: unknown): string | null {
  if (metadata == null) return null;
  const json = JSON.stringify(metadata);
  if (json.length > MAX_METADATA_JSON_LEN) {
    return `metadata too large (${json.length} chars, max ${MAX_METADATA_JSON_LEN})`;
  }
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
