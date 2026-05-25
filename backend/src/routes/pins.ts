/**
 * Pin / achievement endpoints (Slice 3).
 *
 *   Public:
 *     GET    /api/users/:username/pins          — list a user's pins (def joined)
 *
 *   Admin:
 *     GET    /api/admin/pin-definitions          — list defs
 *     POST   /api/admin/pin-definitions          — create def
 *     PATCH  /api/admin/pin-definitions/:id      — edit def
 *     POST   /api/admin/pins/award               — award pin to user
 *     DELETE /api/admin/pins/:id                 — revoke awarded pin
 *
 * Pins are append-only history. The unique index on (user, def, season) means
 * the auto-award job is safe to re-run; the admin authoring path goes through
 * the same insert and surfaces a friendly error on dup.
 */
import { Elysia } from 'elysia';
import { db, schema, sqlite } from '../db';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { checkSeasonArchived } from '../lib/archive-guard';
import {
  S9_AWARDS, S10_AWARDS, mintManualPins, type ManualAward,
} from '../lib/pins/awards-data';
import { runAutoAwards } from '../lib/pins/auto-award';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const VALID_CATEGORIES = ['career', 'season', 'week', 'draft', 'community', 'custom'] as const;
type Category = (typeof VALID_CATEGORIES)[number];

export const pinRoutes = new Elysia()

  // ─── GET /api/users/:username/pins (public) ────────────────────────────
  .get('/api/users/:username/pins', ({ params, set }) => {
    const username = params.username.toLowerCase().trim();
    if (username === 'me') { set.status = 404; return { error: 'Not found' }; }
    const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    if (!user || !user.active) { set.status = 404; return { error: 'User not found' }; }

    // Join pins → pin_definitions; newest first.
    const rows = db.select({
      id: schema.pins.id,
      pinDefId: schema.pins.pinDefId,
      seasonId: schema.pins.seasonId,
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

    return rows.map(r => ({
      id: r.id,
      pinDefId: r.pinDefId,
      seasonId: r.seasonId,
      awardedAt: r.awardedAt,
      awardedBy: r.awardedBy,
      metadata: r.metadata ? safeJson(r.metadata) : null,
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

  // ─── GET /api/admin/pin-definitions ────────────────────────────────────
  .get('/api/admin/pin-definitions', ({ user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    return db.select().from(schema.pinDefinitions)
      .orderBy(asc(schema.pinDefinitions.category), asc(schema.pinDefinitions.name))
      .all();
  })

  // ─── POST /api/admin/pin-definitions ───────────────────────────────────
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

  // ─── PATCH /api/admin/pin-definitions/:id ──────────────────────────────
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

  // ─── POST /api/admin/pins/award ────────────────────────────────────────
  .post('/api/admin/pins/award', ({ query, body, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = body as { userId: number; pinDefId: string; metadata?: Record<string, unknown>; seasonId?: number | null };
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

    // Use INSERT OR IGNORE so admin double-clicking the button is a no-op
    // rather than a 500 from the unique constraint.
    const seasonId = b.seasonId ?? null;
    const metadata = b.metadata ? JSON.stringify(b.metadata) : null;
    const awardedById = user.id ? parseInt(user.id) : null;

    // Insert + activity-log atomically (DEDUP-MISC): the unique indexes
    // (composite for season-scoped, partial `pins_user_def_lifetime_idx` for
    // NULL-season — migration 0041) make INSERT OR IGNORE a no-op on a dupe,
    // so changes=0 → 409 for BOTH season and lifetime pins.
    const out = tx(() => {
      const res = db.run(sql`
        INSERT OR IGNORE INTO pins (user_id, pin_def_id, season_id, awarded_by, metadata)
        VALUES (${b.userId}, ${b.pinDefId}, ${seasonId}, ${awardedById}, ${metadata})
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
        ))
        .orderBy(desc(schema.pins.id))
        .get();

      db.insert(schema.activityLog).values({
        type: 'pin_awarded',
        category: 'admin',
        actor: user.username,
        leagueId: null,
        description: `Awarded '${def.name}' to ${targetUser.username}`,
        metadata: JSON.stringify({
          userId: b.userId,
          username: targetUser.username,
          pinDefId: b.pinDefId,
          pinName: def.name,
          seasonId,
          awardedById,
        }),
      }).run();

      return { duplicate: false as const, id: inserted?.id ?? null };
    });

    if (out.duplicate) {
      set.status = 409;
      return { error: 'User already has this pin for the given season' };
    }

    return { success: true, id: out.id };
  })

  // ─── PATCH /api/admin/pins/:id ─────────────────────────────────────────
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

    if (b.userId !== undefined) {
      const targetUser = db.select().from(schema.users).where(eq(schema.users.id, b.userId)).get();
      if (!targetUser) { set.status = 404; return { error: 'Target user not found' }; }
      // Check for collision with the unique (user_id, pin_def_id, season_id) index.
      if (b.userId !== existing.userId) {
        const collision = db.select().from(schema.pins).where(and(
          eq(schema.pins.userId, b.userId),
          eq(schema.pins.pinDefId, existing.pinDefId),
          existing.seasonId == null
            ? sql`${schema.pins.seasonId} IS NULL`
            : eq(schema.pins.seasonId, existing.seasonId),
        )).get();
        if (collision) {
          set.status = 409;
          return { error: 'Target user already has this pin for the given season' };
        }
      }
      updates.userId = b.userId;
    }
    if (b.metadata !== undefined) {
      updates.metadata = JSON.stringify(b.metadata);
    }

    if (Object.keys(updates).length === 0) return { success: true };

    db.update(schema.pins).set(updates).where(eq(schema.pins.id, id)).run();

    const def = db.select().from(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, existing.pinDefId)).get();
    const newUser = b.userId !== undefined
      ? db.select().from(schema.users).where(eq(schema.users.id, b.userId)).get()
      : null;

    db.insert(schema.activityLog).values({
      type: 'pin_awarded',
      category: 'admin',
      actor: user.username,
      leagueId: null,
      description: `Re-pointed '${def?.name ?? existing.pinDefId}' (pin#${id})${newUser ? ` to ${newUser.username}` : ''}`,
      metadata: JSON.stringify({
        pinId: id,
        previousUserId: existing.userId,
        newUserId: b.userId ?? existing.userId,
        pinDefId: existing.pinDefId,
        seasonId: existing.seasonId,
        override: true,
      }),
    }).run();

    return { success: true };
  })

  // ─── DELETE /api/admin/pins/:id ────────────────────────────────────────
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

  // ─── GET /api/admin/pins/recent (for admin UI's recently-awarded list) ──
  .get('/api/admin/pins/recent', ({ query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const limit = Math.min(Math.max(parseInt(String(query?.limit ?? 50)) || 50, 1), 200);
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
      .orderBy(desc(schema.pins.id))
      .limit(limit)
      .all();
    return rows.map(r => ({ ...r, metadata: r.metadata ? safeJson(r.metadata) : null }));
  })

  // ─── GET /api/admin/pins/manual-awards/:season ─────────────────────────
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

  // ─── POST /api/admin/pins/mint-season ───────────────────────────────────
  // Re-run mintManualPins for a hand-curated season. Idempotent: existing
  // pins survive the (user, def, season) unique index. Returns the
  // ManualMintSummary so the wizard can show inserted/skipped/unresolved
  // counts.
  .post('/api/admin/pins/mint-season', ({ body, user, set }) => {
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

  // ─── POST /api/admin/pins/run-auto ─────────────────────────────────────
  // Run the auto-award (season-end) job for every league belonging to a
  // season. Idempotent: each insert goes through the (user, def, season)
  // unique index. Intended to be called from the admin Pins tab once the
  // season is in offseason / past finals; the UI hides the button mid-season.
  .post('/api/admin/pins/run-auto', ({ body, user, set }) => {
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

    const leagues = db.select().from(schema.leagues)
      .where(eq(schema.leagues.seasonId, seasonRow.id)).all();

    const adminId = user.id ? parseInt(user.id) : null;
    let totalAwarded = 0;
    let totalSkipped = 0;
    const perLeague: { leagueId: string; awarded: number; skipped: number }[] = [];

    for (const league of leagues) {
      const summary = runAutoAwards(league.id, { trigger: 'season-end', awardedBy: adminId });
      totalAwarded += summary.awarded.length;
      totalSkipped += summary.skipped;
      perLeague.push({
        leagueId: league.id,
        awarded: summary.awarded.length,
        skipped: summary.skipped,
      });
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
      }),
    }).run();

    return { success: true, season: seasonNumber, totalAwarded, totalSkipped, perLeague };
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
