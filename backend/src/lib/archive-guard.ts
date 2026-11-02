/**
 * Archive guard — refuses writes targeting an archived season.
 *
 * Each helper returns either `null` (write is allowed) or a response body
 * shaped like `{ error, code: 'season_archived', seasonNumber }` ready to be
 * returned from the route after setting `set.status = 409`.
 *
 * Override: pass `force=true` (typically derived from `query.force === '1'`)
 * to bypass the guard. This mirrors the original inline guard in
 * admin/leagues.ts:42 — admin tooling occasionally needs to amend archived
 * data; ?force=1 is the safety prompt.
 *
 * Variants by lookup key:
 *   - checkSeasonArchived(seasonId)       — direct
 *   - checkLeagueArchived(leagueId)       — JOIN seasons
 *   - checkMatchArchived(matchId)         — JOIN matches → leagues → seasons
 *   - checkTeamArchived(teamId)           — JOIN teams → leagues → seasons
 *
 * If the lookup row doesn't exist, the guard returns null (the route's own
 * 404 handler will fire). Guarding non-existent rows would mask the 404.
 */

import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { isStaff } from './auth';

export interface ArchiveBlock {
  error: string;
  code: 'season_archived';
  seasonNumber: number;
}

/** ?force only counts for staff; callers must pass the session user (omitted = ignored). */
function isForce(force: unknown, user?: { role: string } | null): boolean {
  if (!isStaff(user)) return false;
  return force === true || force === '1' || force === 'true';
}

function block(seasonNumber: number): ArchiveBlock {
  return {
    error: `Season ${seasonNumber} is archived — pass ?force=1 to edit`,
    code: 'season_archived',
    seasonNumber,
  };
}

export function checkSeasonArchived(seasonId: number, force?: unknown, user?: { role: string } | null): ArchiveBlock | null {
  if (isForce(force, user)) return null;
  const season = db.select({
    archived: schema.seasons.archived,
    seasonNumber: schema.seasons.seasonNumber,
  }).from(schema.seasons).where(eq(schema.seasons.id, seasonId)).get();
  if (!season?.archived) return null;
  return block(season.seasonNumber);
}

export function checkLeagueArchived(leagueId: string, force?: unknown, user?: { role: string } | null): ArchiveBlock | null {
  if (isForce(force, user)) return null;
  const row = db.select({
    archived: schema.seasons.archived,
    seasonNumber: schema.seasons.seasonNumber,
  })
    .from(schema.leagues)
    .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!row?.archived) return null;
  return block(row.seasonNumber);
}

export function checkMatchArchived(matchId: string, force?: unknown, user?: { role: string } | null): ArchiveBlock | null {
  if (isForce(force, user)) return null;
  const row = db.select({
    archived: schema.seasons.archived,
    seasonNumber: schema.seasons.seasonNumber,
  })
    .from(schema.matches)
    .innerJoin(schema.leagues, eq(schema.leagues.id, schema.matches.leagueId))
    .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
    .where(eq(schema.matches.id, matchId))
    .get();
  if (!row?.archived) return null;
  return block(row.seasonNumber);
}

export function checkTeamArchived(teamId: string, force?: unknown, user?: { role: string } | null): ArchiveBlock | null {
  if (isForce(force, user)) return null;
  const row = db.select({
    archived: schema.seasons.archived,
    seasonNumber: schema.seasons.seasonNumber,
  })
    .from(schema.teams)
    .innerJoin(schema.leagues, eq(schema.leagues.id, schema.teams.leagueId))
    .innerJoin(schema.seasons, eq(schema.seasons.id, schema.leagues.seasonId))
    .where(eq(schema.teams.id, teamId))
    .get();
  if (!row?.archived) return null;
  return block(row.seasonNumber);
}
