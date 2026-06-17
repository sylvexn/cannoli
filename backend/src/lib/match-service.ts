/**
 * Match result recording — the shared service behind `POST /api/matches/:id/result`.
 *
 * Extracted from the route closure so it can be driven by more than one caller:
 * the admin result endpoint, and the season simulator (`lib/sim/`), which feeds
 * synthetic results through the exact same pipeline so a working mock proves the
 * live result → standings → pins → playoff-bracket path.
 *
 * This module deliberately does NOT do auth or archive checks — those stay with
 * the route. It owns the match-state machine, pokemonData validation, the write
 * transaction, playoff auto-advancement, and per-match pin auto-awards.
 */
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { tx } from './tx';
import { advancePlayoffWinner } from './playoff-advance';
import { runAutoAwards } from './pins/auto-award';
import { validatePokemonDataForMatch } from './match-validation';
import { toCannoliSpeciesName } from './pokedex';
import { matchWinner } from './standings';

export interface PokemonDataEntry {
  teamId: string;
  pokemonName: string;
  kills: number;
  deaths: number;
  teraUsed?: boolean;
  teraType?: string;
}

export interface RecordResultInput {
  homeScore: number;
  awayScore: number;
  replayUrl?: string;
  pokemonData?: PokemonDataEntry[];
  /** Caller-supplied warnings, merged with validation warnings. */
  warnings?: string[];
}

export interface RecordResultOutcome {
  ok: boolean;
  /** HTTP-ish status the route should surface (set only on failure). */
  status?: number;
  error?: string;
  code?: string;
  invalid?: unknown;
  /** Present on success. */
  result?: {
    status: 'completed' | 'disputed';
    warnings: string[];
  };
}

/**
 * Record a result for an existing match. Returns a structured outcome rather
 * than throwing, so both the route and the simulator can branch on it.
 *
 * `actor` is the username (or a synthetic actor like `simulator`) written to
 * the activity log.
 */
export function recordMatchResult(
  matchId: string,
  input: RecordResultInput,
  actor: string,
): RecordResultOutcome {
  const match = db.select().from(schema.matches)
    .where(eq(schema.matches.id, matchId))
    .get();
  if (!match) {
    return { ok: false, status: 404, error: 'Match not found' };
  }

  // State machine enforcement
  if (match.status === 'completed' || match.status === 'disputed') {
    return {
      ok: false,
      status: 400,
      error: `Match already ${match.status} — dismiss warnings or contact admin to re-record`,
    };
  }
  if (match.homeTeamId == null || match.awayTeamId == null) {
    return {
      ok: false,
      status: 400,
      error: 'Cannot record result for a match with TBD teams',
    };
  }

  const { homeScore, awayScore, replayUrl, pokemonData, warnings } = input;
  if (homeScore === undefined || awayScore === undefined) {
    return { ok: false, status: 400, error: 'homeScore and awayScore required' };
  }

  // Validate pokemonData (teamId in {home,away}; pokemonName on roster).
  // Done before the tx so we don't churn the WAL on bad input.
  let mergedWarnings: string[] = warnings?.slice() ?? [];
  if (pokemonData?.length) {
    const validation = validatePokemonDataForMatch(
      pokemonData,
      match.homeTeamId,
      match.awayTeamId,
      { homeScore, awayScore },
    );
    if (!validation.ok) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid pokemonData entries',
        code: 'invalid_pokemon_data',
        invalid: validation.errors,
      };
    }
    // Soft warnings (score/deaths sum mismatch, >6 mons) flow into the
    // existing disputed-status path rather than blocking — admin can
    // dismiss them post-record.
    if (validation.warnings.length > 0) {
      mergedWarnings = mergedWarnings.concat(validation.warnings);
    }
  }

  const newStatus: 'completed' | 'disputed' =
    mergedWarnings.length > 0 ? 'disputed' : 'completed';

  // Winner from the entered KO score (the manual recorder enters real scores).
  // Equal → null (tie / no-contest). Stored explicitly so standings never
  // re-derive W/L from the differential.
  const recordWinnerTeamId = homeScore > awayScore
    ? match.homeTeamId
    : awayScore > homeScore
      ? match.awayTeamId
      : null;

  return tx(() => {
    // Update match
    db.update(schema.matches).set({
      homeScore,
      awayScore,
      winnerTeamId: recordWinnerTeamId,
      replayUrl: replayUrl || match.replayUrl,
      status: newStatus,
      completedAt: new Date().toISOString(),
      warnings: mergedWarnings.length ? JSON.stringify(mergedWarnings) : null,
    }).where(eq(schema.matches.id, matchId)).run();

    // Insert per-pokemon K/D if provided
    if (pokemonData?.length) {
      // Clear existing pokemon data for this match
      db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, matchId)).run();

      for (const p of pokemonData) {
        db.insert(schema.matchPokemon).values({
          matchId,
          teamId: p.teamId,
          // Normalize Mega/Primal to Cannoli convention so K/D JOINs the roster.
          pokemonName: toCannoliSpeciesName(p.pokemonName),
          kills: p.kills,
          deaths: p.deaths,
          teraUsed: p.teraUsed ?? false,
          teraType: p.teraType ?? null,
        }).run();
      }
    }

    // Activity log
    db.insert(schema.activityLog).values({
      type: 'match_result',
      category: 'match',
      actor,
      leagueId: match.leagueId,
      description: `Recorded result for ${match.homeTeamId} vs ${match.awayTeamId}: ${homeScore}-${awayScore}`,
      metadata: JSON.stringify({ matchId, homeScore, awayScore, warningCount: mergedWarnings.length }),
    }).run();

    // ─── Playoff auto-advancement ─────────────────────────────────
    if (newStatus === 'completed' && match.phase === 'playoffs' && match.playoffRound) {
      // home/away are guaranteed non-null here — the TBD guard near the top of
      // this function returns early for an undetermined bracket slot.
      const winnerId = matchWinner({
        winnerTeamId: recordWinnerTeamId,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        homeScore,
        awayScore,
      }) ?? match.homeTeamId!;
      const winnerSeed = winnerId === match.homeTeamId ? match.homeSeed : match.awaySeed;

      advancePlayoffWinner({
        matchId,
        leagueId: match.leagueId,
        playoffRound: match.playoffRound,
        winnerId,
        winnerSeed,
      });
    }

    // ─── Auto-award per-match pins (Kingslayer, Flawless) ─────────
    // Idempotent — re-running on a re-record (after dismiss-warnings) will
    // skip already-awarded rows via the unique index. Safe to run on
    // disputed-status results too: the helpers gate on status='completed'
    // internally, so a 'disputed' record waits until warnings clear.
    if (newStatus === 'completed') {
      runAutoAwards(match.leagueId, { trigger: 'match', matchId });
    }

    return { ok: true, result: { status: newStatus, warnings: mergedWarnings } };
  });
}
