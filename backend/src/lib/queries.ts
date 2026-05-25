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

/** Fetch a single league by id, or undefined if not found. */
export function getLeague(leagueId: string): LeagueRow | undefined {
  return db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
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
