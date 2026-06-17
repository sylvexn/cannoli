/**
 * Shared validation helpers for match result endpoints.
 *
 * The bot path validates parsed-replay results via `validateMatchResult` in
 * `replay-parser.ts` (warnings on roster mismatch, unauthorized tera, format).
 * The REST path (`POST /api/matches/:matchId/result`) accepts a free-form
 * `pokemonData` array. Without these guards a staff member could attribute
 * kills/deaths to a `teamId` outside the match, or to a Pokemon that's not on
 * the named team's roster, silently corrupting the match_pokemon table.
 *
 * Returned errors are structured (machine-readable `code`) and include the
 * offending row so the UI can highlight the bad entry.
 */

import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { toCannoliSpeciesName } from './pokedex';

export interface PokemonDataEntry {
  teamId: string;
  pokemonName: string;
  kills: number;
  deaths: number;
  teraUsed?: boolean;
  teraType?: string;
  brought?: boolean;
}

export interface PokemonDataValidationError {
  index: number;
  teamId: string;
  pokemonName: string;
  reason: string;
}

export interface PokemonDataValidationResult {
  ok: boolean;
  errors: PokemonDataValidationError[];
  warnings: string[];
}

/**
 * Pure validator: caller supplies the rosters. Used by tests to avoid
 * standing up a DB; production callers use {@link validatePokemonDataForMatch}.
 *
 *   - Every entry's `teamId` MUST be one of `homeTeamId` / `awayTeamId`.
 *   - Every entry's `pokemonName` MUST exist on that team's roster
 *     (case-insensitive).
 *
 * Both checks are needed because the API layer trusts the staff client; a
 * typo in the team picker or a roster sync bug would otherwise insert
 * orphan rows that the analytics and replay-summary endpoints can't render.
 */
export function validatePokemonData(
  entries: PokemonDataEntry[],
  homeTeamId: string,
  awayTeamId: string,
  rosterByTeam: Map<string, Set<string>>,
  scores?: { homeScore: number; awayScore: number },
): PokemonDataValidationResult {
  const errors: PokemonDataValidationError[] = [];
  const warnings: string[] = [];
  const allowedTeamIds = new Set([homeTeamId, awayTeamId]);

  entries.forEach((entry, index) => {
    if (!allowedTeamIds.has(entry.teamId)) {
      errors.push({
        index,
        teamId: entry.teamId,
        pokemonName: entry.pokemonName,
        reason: `teamId must be one of ${homeTeamId}, ${awayTeamId}`,
      });
      return;
    }

    const roster = rosterByTeam.get(entry.teamId);
    if (!roster || !roster.has(toCannoliSpeciesName(entry.pokemonName).toLowerCase())) {
      errors.push({
        index,
        teamId: entry.teamId,
        pokemonName: entry.pokemonName,
        reason: `Pokemon "${entry.pokemonName}" is not on team ${entry.teamId}'s roster`,
      });
    }
  });

  // Internal-consistency warnings — only meaningful when scores are supplied
  // and entries are well-formed (skip if any teamId is off-match to avoid
  // double-flagging a typo-ridden submission).
  const teamIdsOk = entries.every(e => allowedTeamIds.has(e.teamId));
  if (teamIdsOk && entries.length > 0) {
    let homeDeaths = 0, awayDeaths = 0, homeCount = 0, awayCount = 0;
    for (const e of entries) {
      if (e.teamId === homeTeamId) {
        homeDeaths += e.deaths ?? 0;
        homeCount++;
      } else if (e.teamId === awayTeamId) {
        awayDeaths += e.deaths ?? 0;
        awayCount++;
      }
    }

    if (scores) {
      // homeScore = KOs scored by home = deaths inflicted on away team
      if (scores.homeScore !== awayDeaths) {
        warnings.push(
          `homeScore=${scores.homeScore} but away-team deaths sum to ${awayDeaths}`,
        );
      }
      if (scores.awayScore !== homeDeaths) {
        warnings.push(
          `awayScore=${scores.awayScore} but home-team deaths sum to ${homeDeaths}`,
        );
      }
    }

    if (homeCount > 6) {
      warnings.push(
        `${homeCount} Pokemon entries for home team — more than 6 brought to a singles match is unusual`,
      );
    }
    if (awayCount > 6) {
      warnings.push(
        `${awayCount} Pokemon entries for away team — more than 6 brought to a singles match is unusual`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * DB-backed wrapper used by the REST handler. Loads each team's roster
 * once (two queries per match) and delegates to {@link validatePokemonData}.
 */
export function validatePokemonDataForMatch(
  entries: PokemonDataEntry[],
  homeTeamId: string,
  awayTeamId: string,
  scores?: { homeScore: number; awayScore: number },
): PokemonDataValidationResult {
  const rosterByTeam = new Map<string, Set<string>>();
  for (const teamId of [homeTeamId, awayTeamId]) {
    const rows = db.select({ pokemonName: schema.rosters.pokemonName })
      .from(schema.rosters)
      .where(eq(schema.rosters.teamId, teamId))
      .all();
    rosterByTeam.set(
      teamId,
      new Set(rows.map(r => toCannoliSpeciesName(r.pokemonName).toLowerCase())),
    );
  }
  return validatePokemonData(entries, homeTeamId, awayTeamId, rosterByTeam, scores);
}
