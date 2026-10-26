/**
 * Playoff bracket approval flow (staff-only).
 *
 *   GET    /api/admin/playoffs/overview               leagues + draft state (admin page list)
 *   GET    /api/admin/playoffs/drafts/pending         unpublished drafts (dashboard widget)
 *   GET    /api/admin/leagues/:leagueId/playoffs/draft      draft (or standings default) + live validation
 *   PUT    /api/admin/leagues/:leagueId/playoffs/draft      upsert { topN, seedOrder }
 *   DELETE /api/admin/leagues/:leagueId/playoffs/draft      discard (draft state only)
 *   POST   /api/admin/leagues/:leagueId/playoffs/publish    write bracket + notify seeded coaches
 *   POST   /api/admin/leagues/:leagueId/playoffs/unpublish  back to draft while no game has started
 *
 * Drafts live in `playoff_drafts`; `matches` rows only exist after publish.
 */
import { Elysia } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { requireStaff } from '../../lib/auth-guards';
import { checkLeagueArchived } from '../../lib/archive-guard';
import { getLeague } from '../../lib/queries';
import { computeStandings } from '../../lib/standings';
import {
  BRACKET_SIZES, checkDraftInput, getDraft, isLocked, playoffMatches,
  publishDraft, unpublishDraft, validateSeeding,
} from '../../lib/playoff-publish';

type Ctx = { params: { leagueId: string }; user: { username: string } | null; set: { status?: number | string } };

/** 404 for unknown league, 409 for archived; null when OK to proceed. */
function guardLeague(id: string, set: Ctx['set'], mutating: boolean) {
  if (!getLeague(id)) { set.status = 404; return { error: 'League not found' }; }
  if (mutating) {
    const archived = checkLeagueArchived(id);
    if (archived) { set.status = 409; return archived; }
  }
  return null;
}

function view(leagueId: string) {
  const league = getLeague(leagueId)!;
  const standings = computeStandings(leagueId);
  const teams = new Map(db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all().map(t => [t.id, t]));
  const draft = getDraft(leagueId);
  const rows = playoffMatches(leagueId);
  const standingsIds = standings.map(s => s.id);
  let order = standingsIds;
  if (draft) {
    const saved = (JSON.parse(draft.seedOrder) as string[]).filter(id => teams.has(id));
    order = [...saved, ...standingsIds.filter(id => !saved.includes(id))];
  }
  const topN = draft?.topN ?? league.playoffTeamCount ?? 6;
  return {
    leagueId, leagueName: league.name, phase: league.phase,
    status: (draft?.status ?? 'none') as 'none' | 'draft' | 'published',
    topN, bracketSizes: BRACKET_SIZES,
    seedOrder: order,
    standings: standings.map((s, i) => {
      const t = teams.get(s.id);
      return {
        teamId: s.id, rank: i + 1, teamName: t?.teamName ?? s.id, abbrev: t?.teamAbbrev ?? '', color: t?.teamColor ?? '#888888',
        coachName: t?.coachName ?? '', hasCoach: !!t?.userId, wins: s.wins, losses: s.losses, differential: s.differential,
        tiebreaker: s.tiebreaker,
      };
    }),
    warnings: BRACKET_SIZES.includes(topN) && order.length >= topN ? validateSeeding(leagueId, order, topN) : [],
    matchCount: rows.length,
    locked: isLocked(rows),
    // Matches exist without a published draft = generated through the legacy path.
    legacyBracket: rows.length > 0 && draft?.status !== 'published',
    publishedAt: draft?.publishedAt ?? null,
    updatedAt: draft?.updatedAt ?? null,
  };
}

export const playoffsAdminRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  .get('/api/admin/playoffs/overview', () => {
    const rows = db.select({ league: schema.leagues, archived: schema.seasons.archived })
      .from(schema.leagues).innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId)).all();
    return {
      leagues: rows.filter(r => !r.archived).map(({ league }) => {
        const draft = getDraft(league.id);
        const matches = playoffMatches(league.id);
        return {
          leagueId: league.id, leagueName: league.name, phase: league.phase,
          status: (draft?.status ?? 'none') as 'none' | 'draft' | 'published',
          topN: draft?.topN ?? league.playoffTeamCount ?? 6,
          matchCount: matches.length, locked: isLocked(matches),
          legacyBracket: matches.length > 0 && draft?.status !== 'published',
          updatedAt: draft?.updatedAt ?? null,
        };
      }),
    };
  })

  .get('/api/admin/playoffs/drafts/pending', () => {
    const rows = db.select({ d: schema.playoffDrafts, name: schema.leagues.name, archived: schema.seasons.archived })
      .from(schema.playoffDrafts)
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.playoffDrafts.leagueId))
      .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
      .where(eq(schema.playoffDrafts.status, 'draft')).all();
    return {
      drafts: rows.filter(r => !r.archived).map(r => ({
        leagueId: r.d.leagueId, leagueName: r.name, updatedAt: r.d.updatedAt, topN: r.d.topN,
      })),
    };
  })

  .get('/api/admin/leagues/:leagueId/playoffs/draft', ({ params, set }: Ctx) =>
    guardLeague(params.leagueId, set, false) ?? view(params.leagueId))

  .put('/api/admin/leagues/:leagueId/playoffs/draft', ({ params, body, user, set }: Ctx & { body: unknown }) => {
    const denied = guardLeague(params.leagueId, set, true);
    if (denied) return denied;
    const draft = getDraft(params.leagueId);
    if (draft?.status === 'published') {
      set.status = 409;
      return { error: 'Bracket is published - unpublish it to edit seeding.', code: 'published' };
    }
    if (!draft && playoffMatches(params.leagueId).length > 0) {
      set.status = 409;
      return { error: 'A bracket already exists for this league (generated outside the draft flow).', code: 'bracket_exists' };
    }
    const b = (body ?? {}) as { topN?: number; seedOrder?: string[] };
    const checked = checkDraftInput(params.leagueId, b.topN, b.seedOrder);
    if ('status' in checked) { set.status = checked.status; return { error: checked.error, code: checked.code }; }
    const actor = user?.username ?? 'unknown';
    const seedOrder = JSON.stringify(checked.order);
    if (draft) {
      db.update(schema.playoffDrafts).set({ topN: checked.topN, seedOrder, updatedBy: actor, updatedAt: new Date().toISOString() })
        .where(eq(schema.playoffDrafts.leagueId, params.leagueId)).run();
    } else {
      db.insert(schema.playoffDrafts).values({
        leagueId: params.leagueId, topN: checked.topN, seedOrder, createdBy: actor, updatedBy: actor,
      }).run();
      db.insert(schema.activityLog).values({
        type: 'playoffs_draft_created', category: 'match', actor, leagueId: params.leagueId,
        description: `Created a ${checked.topN}-team playoff bracket draft`,
      }).run();
    }
    return view(params.leagueId);
  })

  .delete('/api/admin/leagues/:leagueId/playoffs/draft', ({ params, user, set }: Ctx) => {
    const denied = guardLeague(params.leagueId, set, true);
    if (denied) return denied;
    const draft = getDraft(params.leagueId);
    if (!draft) { set.status = 404; return { error: 'No draft', code: 'no_draft' }; }
    if (draft.status === 'published') {
      set.status = 409;
      return { error: 'Published brackets cannot be discarded - unpublish first.', code: 'published' };
    }
    db.delete(schema.playoffDrafts).where(and(
      eq(schema.playoffDrafts.leagueId, params.leagueId), eq(schema.playoffDrafts.status, 'draft'))).run();
    db.insert(schema.activityLog).values({
      type: 'playoffs_draft_discarded', category: 'match', actor: user?.username ?? 'unknown', leagueId: params.leagueId,
      description: 'Discarded the playoff bracket draft',
    }).run();
    return { success: true };
  })

  .post('/api/admin/leagues/:leagueId/playoffs/publish', ({ params, user, set }: Ctx) => {
    const denied = guardLeague(params.leagueId, set, true);
    if (denied) return denied;
    const r = publishDraft(params.leagueId, user?.username ?? 'unknown');
    if ('status' in r) { set.status = r.status; return { error: r.error, code: r.code }; }
    return { success: true, ...r };
  })

  .post('/api/admin/leagues/:leagueId/playoffs/unpublish', ({ params, user, set }: Ctx) => {
    const denied = guardLeague(params.leagueId, set, true);
    if (denied) return denied;
    const r = unpublishDraft(params.leagueId, user?.username ?? 'unknown');
    if ('status' in r) { set.status = r.status; return { error: r.error, code: r.code }; }
    return { success: true, ...r };
  });
