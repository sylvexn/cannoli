/**
 * Awards Sheet endpoints (staff only). Awards are admin-curated: the engine
 * only SUGGESTS (lib/pins/suggest.ts); staff save drafts, then publish.
 *
 *   GET  /api/admin/pins/suggest?seasonId=&leagueId=   — suggestions + unresolved (pure read)
 *   GET  /api/admin/pins/season/:seasonId              — every pin (drafts included) in a season
 *   POST /api/admin/pins/bulk?force=1                  — transactional save for ONE pin definition
 *   POST /api/admin/pins/publish?force=1               — publish (or unpublish) a season / league
 *
 * Publishing sends no notifications.
 */
import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { isStaff } from '../lib/auth';
import { tx } from '../lib/tx';
import { checkSeasonArchived } from '../lib/archive-guard';
import { suggestAwards } from '../lib/pins/suggest';
import { parseMetadataFields } from '../lib/pins/defs';

/** Derived stat keys a client may echo back from a suggestion into metadata. */
const STAT_KEYS = [
  'kills', 'wins', 'losses', 'diff', 'streak', 'seriesScore', 'runnerUpTeamId', 'scoreLine',
  'sweeps', 'week', 'phase', 'cost', 'ratio', 'winnerRank', 'loserRank', 'loserTeamId',
] as const;

export type BulkChange =
  | {
    op: 'award'; teamId: string; pokemon?: string; nickname?: string; note?: string;
    matchId?: string; stats?: Record<string, unknown>;
  }
  | { op: 'revoke'; pinId: number };

interface RowError { index: number; error: string }

export const pinAwardRoutes = new Elysia()

  .get('/api/admin/pins/suggest', ({ query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const seasonId = parseInt(String(query?.seasonId));
    if (!Number.isFinite(seasonId)) { set.status = 400; return { error: 'seasonId is required' }; }
    return suggestAwards(seasonId, query?.leagueId ? String(query.leagueId) : undefined);
  })

  .get('/api/admin/pins/season/:seasonId', ({ params, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const seasonId = parseInt(params.seasonId);
    if (!Number.isFinite(seasonId)) { set.status = 400; return { error: 'Invalid seasonId' }; }
    const rows = db.select({
      id: schema.pins.id,
      pinDefId: schema.pins.pinDefId,
      teamId: schema.pins.teamId,
      leagueId: schema.pins.leagueId,
      matchId: schema.pins.matchId,
      published: schema.pins.published,
      source: schema.pins.source,
      awardedAt: schema.pins.awardedAt,
      metadata: schema.pins.metadata,
      username: schema.users.username,
    })
      .from(schema.pins)
      .leftJoin(schema.teams, eq(schema.teams.id, schema.pins.teamId))
      .leftJoin(schema.users, eq(schema.users.id, sql`COALESCE(${schema.teams.userId}, ${schema.pins.userId})`))
      .where(eq(schema.pins.seasonId, seasonId))
      .all();
    return {
      seasonId,
      pins: rows.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null })),
    };
  })

  .post('/api/admin/pins/bulk', ({ body, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = body as { seasonId: number; pinDefId: string; changes: BulkChange[] };
    if (!Number.isFinite(b?.seasonId) || !b.pinDefId || !Array.isArray(b.changes)) {
      set.status = 400;
      return { error: 'seasonId, pinDefId and changes[] are required' };
    }
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, b.seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }
    const archived = checkSeasonArchived(b.seasonId, query.force);
    if (archived) { set.status = 409; return archived; }
    const def = db.select().from(schema.pinDefinitions).where(eq(schema.pinDefinitions.id, b.pinDefId)).get();
    if (!def) { set.status = 404; return { error: 'Pin definition not found' }; }
    const fields = parseMetadataFields(def.metadataFields);

    // Validate EVERY row first; any error means nothing is written.
    const errors: RowError[] = [];
    type Planned = {
      kind: 'award'; leagueId: string | null; teamId: string; matchId: string | null;
      metadata: Record<string, unknown>;
    } | { kind: 'revoke'; pinId: number };
    const plan: Planned[] = [];
    const seen = new Set<string>();

    b.changes.forEach((c, index) => {
      const fail = (error: string) => { errors.push({ index, error }); };
      if (c.op === 'revoke') {
        const pin = db.select().from(schema.pins).where(eq(schema.pins.id, c.pinId)).get();
        if (!pin || pin.pinDefId !== def.id || pin.seasonId !== b.seasonId) return fail('Pin not found in this season');
        plan.push({ kind: 'revoke', pinId: pin.id });
        return;
      }
      if (c.op !== 'award') return fail('Unknown op');
      const team = db.select().from(schema.teams).where(eq(schema.teams.id, c.teamId)).get();
      if (!team) return fail(`Team '${c.teamId}' not found`);
      const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get();
      if (!league || league.seasonId !== b.seasonId) return fail(`${team.teamName} is not in this season`);

      let matchId: string | null = null;
      if (def.scope === 'match' || fields.includes('match')) {
        const m = c.matchId
          ? db.select().from(schema.matches).where(eq(schema.matches.id, c.matchId)).get()
          : undefined;
        if (!m || m.leagueId !== team.leagueId || (m.homeTeamId !== team.id && m.awayTeamId !== team.id)) {
          return fail(`${team.teamName}: pick a match this team played`);
        }
        matchId = m.id;
      }

      const metadata: Record<string, unknown> = {};
      for (const k of STAT_KEYS) {
        const v = c.stats?.[k];
        if (typeof v === 'number' || (typeof v === 'string' && v.length <= 80)) metadata[k] = v;
      }
      metadata.teamId = team.id;
      metadata.leagueId = team.leagueId;
      if (matchId) metadata.matchId = matchId;

      if (fields.includes('pokemon')) {
        const wanted = (c.pokemon ?? '').trim();
        if (!wanted) return fail(`${team.teamName}: pick a Pokemon`);
        const canon = canonicalMon(team.id, wanted);
        if (!canon) return fail(`${wanted} is not on ${team.teamName}'s roster`);
        metadata.pokemon = canon;
      }
      if (fields.includes('nickname')) {
        const nick = (c.nickname ?? '').trim();
        if (!nick) return fail(`${team.teamName}: nickname required`);
        metadata.nickname = nick.slice(0, 60);
      }
      if (fields.includes('note') && c.note?.trim()) metadata.note = c.note.trim().slice(0, 200);

      const leagueId = def.scope === 'season' ? null : team.leagueId;
      const key = `${team.id}|${matchId ?? ''}`;
      if (seen.has(key)) return fail(`${team.teamName}: duplicate row`);
      seen.add(key);
      plan.push({ kind: 'award', leagueId, teamId: team.id, matchId, metadata });
    });

    if (errors.length > 0) { set.status = 422; return { success: false, errors }; }

    const awardedBy = user.id ? parseInt(user.id) : null;
    const counts = { created: 0, updated: 0, revoked: 0 };
    tx(() => {
      for (const p of plan) {
        if (p.kind === 'revoke') {
          db.delete(schema.pins).where(eq(schema.pins.id, p.pinId)).run();
          counts.revoked++;
          continue;
        }
        const existing = db.select({ id: schema.pins.id }).from(schema.pins).where(and(
          eq(schema.pins.teamId, p.teamId), eq(schema.pins.pinDefId, def.id),
          eq(schema.pins.seasonId, b.seasonId),
          p.leagueId == null ? sql`${schema.pins.leagueId} IS NULL` : eq(schema.pins.leagueId, p.leagueId),
          p.matchId == null ? sql`${schema.pins.matchId} IS NULL` : eq(schema.pins.matchId, p.matchId),
        )).get();
        if (existing) {
          db.update(schema.pins).set({ metadata: JSON.stringify(p.metadata), source: 'manual', awardedBy })
            .where(eq(schema.pins.id, existing.id)).run();
          counts.updated++;
        } else {
          db.insert(schema.pins).values({
            teamId: p.teamId, pinDefId: def.id, seasonId: b.seasonId, leagueId: p.leagueId,
            matchId: p.matchId, awardedBy, source: 'manual', published: false,
            metadata: JSON.stringify(p.metadata),
          }).run();
          counts.created++;
        }
      }
      db.insert(schema.activityLog).values({
        type: 'pin_awarded',
        category: 'admin',
        actor: user.username,
        leagueId: null,
        description: `Saved '${def.name}' awards for S${season.seasonNumber}: ${counts.created} new, ${counts.updated} updated, ${counts.revoked} revoked (drafts)`,
        metadata: JSON.stringify({ bulk: true, pinDefId: def.id, seasonId: b.seasonId, ...counts }),
      }).run();
    });

    return { success: true, ...counts };
  })

  .post('/api/admin/pins/publish', ({ body, query, user, set }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
    const b = body as { seasonId: number; leagueId?: string | null; published?: boolean };
    if (!Number.isFinite(b?.seasonId)) { set.status = 400; return { error: 'seasonId is required' }; }
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.id, b.seasonId)).get();
    if (!season) { set.status = 404; return { error: 'Season not found' }; }
    const archived = checkSeasonArchived(b.seasonId, query.force);
    if (archived) { set.status = 409; return archived; }

    const published = b.published !== false;
    // A league publish covers that league; a season publish covers everything,
    // including season-wide (league-less) awards.
    const scope = b.leagueId
      ? and(eq(schema.pins.seasonId, b.seasonId), eq(schema.pins.leagueId, b.leagueId))
      : eq(schema.pins.seasonId, b.seasonId);
    const ids = db.select({ id: schema.pins.id }).from(schema.pins)
      .where(and(scope, eq(schema.pins.published, !published))).all().map(r => r.id);
    if (ids.length > 0) {
      db.update(schema.pins).set({ published }).where(inArray(schema.pins.id, ids)).run();
    }
    db.insert(schema.activityLog).values({
      type: 'pin_awarded',
      category: 'admin',
      actor: user.username,
      leagueId: b.leagueId ?? null,
      description: `${published ? 'Published' : 'Unpublished'} ${ids.length} S${season.seasonNumber} award(s)${b.leagueId ? ` in ${b.leagueId}` : ''}`,
      metadata: JSON.stringify({ publish: published, seasonId: b.seasonId, leagueId: b.leagueId ?? null, count: ids.length }),
    }).run();
    return { success: true, published, count: ids.length };
  });

/** Canonical roster spelling for a Pokemon on this team (or one that played
 *  for it, so a traded-away mon can still be honoured), else null. */
function canonicalMon(teamId: string, name: string): string | null {
  const lower = name.toLowerCase();
  const onRoster = db.select({ n: schema.rosters.pokemonName }).from(schema.rosters)
    .where(and(eq(schema.rosters.teamId, teamId), sql`LOWER(${schema.rosters.pokemonName}) = ${lower}`)).get();
  if (onRoster) return onRoster.n;
  const played = db.select({ n: schema.matchPokemon.pokemonName }).from(schema.matchPokemon)
    .where(and(eq(schema.matchPokemon.teamId, teamId), sql`LOWER(${schema.matchPokemon.pokemonName}) = ${lower}`)).get();
  return played?.n ?? null;
}
