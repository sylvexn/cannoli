/**
 * Shared query helpers for the most common single-row / single-table reads.
 *
 * These exist because the same `db.select().from(...).where(eq(...)).get()`
 * incantations were repeated 10+ times across the routes. Centralising them
 * keeps call sites short and ensures a consistent return shape (drizzle's
 * inferred row types).
 *
 * NOTE: admin.ts and leagues.ts intentionally still inline these queries —
 * those files are pending a split into sub-folders, so duplications there
 * are deferred.
 */

import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { isStaff } from './auth';

export type LeagueRow = typeof schema.leagues.$inferSelect;
export type TeamRow = typeof schema.teams.$inferSelect;
export type RosterRow = typeof schema.rosters.$inferSelect;

/** The league lifecycle phases (mirrors the `leagues.phase` enum in schema.ts). */
export type LeaguePhase = NonNullable<LeagueRow['phase']>;
export const LEAGUE_PHASES = ['predraft', 'draft', 'regular', 'playoffs', 'offseason'] as const;
/** Narrowing guard so handlers can validate a string body field into the union
 *  and drop the `phase as any` casts when writing it back to the DB. */
export function isLeaguePhase(v: unknown): v is LeaguePhase {
  return typeof v === 'string' && (LEAGUE_PHASES as readonly string[]).includes(v);
}

/**
 * Whether a league's trade deadline has passed (a non-positive deadline means
 * "no deadline"). Shared by the trade routes and the expire-trades job so the
 * two never disagree about when trading closes.
 *
 * `tradeDeadlineWeek` is the LAST week trades may be made — week 7 deadline
 * means week 7 still trades, week 8 does not. Approvals take effect the
 * following week (resolveEffectiveWeek defaults to currentWeek + 1), so a
 * deadline-week trade legitimately LANDS in deadline + 1; the landing bound in
 * routes/trades.ts and lib/free-agency.ts is deadline + 1 for that reason.
 */
export function isTradeDeadlinePassed(
  league: { tradeDeadlineWeek: number; currentWeek: number } | null | undefined,
): boolean {
  if (!league) return false;
  if (league.tradeDeadlineWeek <= 0) return false;
  return league.currentWeek > league.tradeDeadlineWeek;
}

/** Fetch a single league by id, or undefined if not found. */
export function getLeague(leagueId: string): LeagueRow | undefined {
  return db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
}

/**
 * Results-reveal gate: the highest week whose results are published for a
 * league, or null when the gate is off (everything published).
 */
export function revealedMaxWeek(leagueId: string): number | null {
  return getLeague(leagueId)?.resultsRevealedThrough ?? null;
}

/**
 * Whether a single match's result may be shown to this viewer.
 *
 * Staff bypass the gate — the stream cockpit reviews results before publishing
 * them, so admins must see an unrevealed week. Everyone else (including
 * anonymous) is limited to the league's revealed high-water mark.
 *
 * Every endpoint that returns a match's scores, per-mon K/D, or replay log MUST
 * route through this — the gate was previously copy-pasted per handler, which
 * is exactly how /replay-summary, /pokemon and /replay.json ended up serving
 * unrevealed results to anonymous callers.
 */
export function isMatchRevealed(
  match: { leagueId: string; week: number | null },
  user: { role: string } | null | undefined,
): boolean {
  if (isStaff(user)) return true;
  const gate = revealedMaxWeek(match.leagueId);
  return gate == null || (match.week ?? 0) <= gate;
}

/** Result of the membership-editability check — a structured ok/blocked shape
 *  matching the `{ error, code }` convention the admin routes return. */
export type MembershipGate =
  | { ok: true }
  | { ok: false; reason: string; code: string };

/**
 * Whether a league's coach membership (add / remove / move coaches) can still be
 * edited. Allowed only *before the draft actually starts*: `predraft`, or
 * `draft` phase while the draft hasn't begun. Once the draft is in
 * progress / paused / completed — or the league has advanced to regular+ —
 * membership is locked, because from that point on a coach has rosters,
 * matches, standings and trades that a naive move/remove would strand.
 *
 * Shared by every membership handler so the gate can never drift between them.
 */
export function isMembershipEditable(leagueId: string): MembershipGate {
  const league = getLeague(leagueId);
  if (!league) return { ok: false, reason: 'League not found', code: 'league_not_found' };
  if (league.phase !== 'predraft' && league.phase !== 'draft') {
    return {
      ok: false,
      reason: `League is in ${league.phase} phase — membership locks once the season is underway`,
      code: 'membership_locked_phase',
    };
  }
  const ds = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId)).get();
  if (ds && (ds.status !== 'not_started' || ds.currentPickIndex > 0)) {
    return {
      ok: false,
      reason: 'Draft has already started — membership is locked',
      code: 'membership_locked_draft',
    };
  }
  return { ok: true };
}

/** Fetch a league together with its teams. Returns undefined if league is missing. */
export function getLeagueWithTeams(
  leagueId: string,
): { league: LeagueRow; teams: TeamRow[] } | undefined {
  const league = getLeague(leagueId);
  if (!league) return undefined;
  const teams = db.select().from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all();
  return { league, teams };
}

/** Fetch every roster row for a given team. */
export function getTeamRoster(teamId: string): RosterRow[] {
  return db.select().from(schema.rosters)
    .where(eq(schema.rosters.teamId, teamId))
    .all();
}
