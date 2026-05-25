/**
 * simulateSeason / simulatePlayoffs — the season driver for the simulator.
 *
 * This module owns the league lifecycle past the draft. It ensures a schedule
 * exists, then walks every scheduled regular-season match (up to an optional
 * cutoff week), loads both rosters from the DB, calls the pure `simulateMatch`,
 * and feeds the synthetic result through the REAL `recordMatchResult` pipeline
 * (actor = 'simulator'). Because results flow through the genuine service, a
 * working simulated season exercises standings, pin auto-awards, and the
 * playoff bracket exactly as a live season would.
 *
 * `simulatePlayoffs` triggers bracket generation then sims bracket matches in
 * round order (qf → sf → f) so `recordMatchResult`'s playoff auto-advance chains
 * the winners forward correctly.
 *
 * Functions are composable: the sim API and the seed-sim script both call them.
 */
import { db, schema } from '../../db';
import { and, asc, eq } from 'drizzle-orm';
import { tx } from '../tx';
import { generateLeagueSchedule } from '../schedule-generator';
import { recordMatchResult } from '../match-service';
import { computeStandings } from '../standings';
import { simulateMatch, type SimRosterMon } from './simulate-match';
import type { MockRng } from './mock-rng';
import { assertMockMode } from './sim-guard';

const SIM_ACTOR = 'simulator';

export interface SimulateSeasonResult {
  success: boolean;
  error?: string;
  /** Regular-season matches recorded by this call. */
  matchesPlayed: number;
  /** Highest week reached. */
  throughWeek: number;
}

export interface SimulatePlayoffsResult {
  success: boolean;
  error?: string;
  /** Playoff matches recorded by this call. */
  matchesPlayed: number;
  championId: string | null;
}

/** Load a team's roster as the {pokemonName, tier} shape simulateMatch wants. */
function loadRoster(teamId: string): SimRosterMon[] {
  return db.select({
    pokemonName: schema.rosters.pokemonName,
    tier: schema.rosters.tier,
  })
    .from(schema.rosters)
    .where(eq(schema.rosters.teamId, teamId))
    .all();
}

/**
 * Simulate the regular season for a league.
 *
 * Ensures a round-robin schedule exists (generates one if the league has no
 * regular matches), advances the league into `regular` phase if it is still
 * sitting in `draft`, then records a result for every scheduled match with
 * `week <= throughWeek` (defaults to the full schedule). Already-completed
 * matches are skipped, so calling repeatedly with an increasing `throughWeek`
 * incrementally plays the season out.
 */
export function simulateSeason(opts: {
  leagueId: string;
  throughWeek?: number;
  rng: MockRng;
}): SimulateSeasonResult {
  assertMockMode();
  const { leagueId, rng } = opts;

  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) {
    return { success: false, error: 'League not found', matchesPlayed: 0, throughWeek: 0 };
  }

  // Ensure a schedule exists.
  const existingRegular = db.select().from(schema.matches)
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'regular')))
    .all();
  if (existingRegular.length === 0) {
    const gen = generateLeagueSchedule(leagueId);
    if (!gen.success) {
      return { success: false, error: gen.error, matchesPlayed: 0, throughWeek: 0 };
    }
  }

  // Move the league into regular phase if it is still in draft. The real
  // tera-captains route does this transition; the sim driver owns it here so
  // the season can be played without round-tripping the captain endpoint.
  if (league.phase === 'draft' || league.phase === 'predraft') {
    db.update(schema.leagues)
      .set({ phase: 'regular', currentWeek: Math.max(1, league.currentWeek) })
      .where(eq(schema.leagues.id, leagueId))
      .run();
  }

  const matches = db.select().from(schema.matches)
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'regular')))
    .orderBy(asc(schema.matches.week), asc(schema.matches.id))
    .all();

  const maxWeek = matches.reduce((m, x) => Math.max(m, x.week), 0);
  const throughWeek = opts.throughWeek ?? maxWeek;

  let played = 0;
  let reachedWeek = 0;
  for (const match of matches) {
    if (match.week > throughWeek) break;
    reachedWeek = Math.max(reachedWeek, match.week);
    if (match.status === 'completed' || match.status === 'disputed') continue;
    if (match.homeTeamId == null || match.awayTeamId == null) continue;

    const sim = simulateMatch({
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeRoster: loadRoster(match.homeTeamId),
      awayRoster: loadRoster(match.awayTeamId),
      rng,
      isPlayoff: false,
    });

    const outcome = recordMatchResult(match.id, {
      homeScore: sim.homeScore,
      awayScore: sim.awayScore,
      replayUrl: sim.replayUrl,
      pokemonData: sim.pokemonData,
    }, SIM_ACTOR);

    if (!outcome.ok) {
      return {
        success: false,
        error: `recordMatchResult failed for ${match.id}: ${outcome.error}`,
        matchesPlayed: played,
        throughWeek: reachedWeek,
      };
    }
    played++;
  }

  // Keep the league's currentWeek pointer in step with how far we played.
  if (reachedWeek > 0) {
    db.update(schema.leagues)
      .set({ currentWeek: Math.min(reachedWeek, maxWeek) })
      .where(eq(schema.leagues.id, leagueId))
      .run();
  }

  return { success: true, matchesPlayed: played, throughWeek: reachedWeek };
}

/**
 * Generate and play out a league's playoff bracket.
 *
 * Builds the bracket with the same logic as `POST /playoffs/generate` (top-N
 * teams by `computeStandings`, seeded matchups), flips the league into
 * `playoffs` phase, then sims matches round-by-round (qf → sf → f). Each result
 * goes through `recordMatchResult`, whose playoff auto-advance fills the next
 * round's TBD slots — so by the time we reach the finals both finalists are set.
 *
 * Returns the champion's teamId.
 */
export function simulatePlayoffs(leagueId: string, rng: MockRng): SimulatePlayoffsResult {
  assertMockMode();

  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) {
    return { success: false, error: 'League not found', matchesPlayed: 0, championId: null };
  }

  const gen = generatePlayoffBracket(leagueId);
  if (!gen.success) {
    return { success: false, error: gen.error, matchesPlayed: 0, championId: null };
  }

  db.update(schema.leagues)
    .set({ phase: 'playoffs' })
    .where(eq(schema.leagues.id, leagueId))
    .run();

  let played = 0;
  // Round order matters: qf results must be recorded before sf so the bracket
  // auto-advance has filled the sf TBD slots, and likewise sf before f.
  for (const round of ['qf', 'sf', 'f'] as const) {
    const roundMatches = db.select().from(schema.matches)
      .where(and(
        eq(schema.matches.leagueId, leagueId),
        eq(schema.matches.phase, 'playoffs'),
        eq(schema.matches.playoffRound, round),
      ))
      .orderBy(asc(schema.matches.id))
      .all();

    for (const match of roundMatches) {
      // Re-read: a prior round's auto-advance may have filled this match's
      // home/away after the initial query above.
      const fresh = db.select().from(schema.matches)
        .where(eq(schema.matches.id, match.id))
        .get();
      if (!fresh || fresh.status === 'completed' || fresh.status === 'disputed') continue;
      if (fresh.homeTeamId == null || fresh.awayTeamId == null) {
        return {
          success: false,
          error: `Playoff match ${match.id} still has a TBD slot — bracket advance broke`,
          matchesPlayed: played,
          championId: null,
        };
      }

      const sim = simulateMatch({
        homeTeamId: fresh.homeTeamId,
        awayTeamId: fresh.awayTeamId,
        homeRoster: loadRoster(fresh.homeTeamId),
        awayRoster: loadRoster(fresh.awayTeamId),
        rng,
        isPlayoff: true,
      });

      const outcome = recordMatchResult(fresh.id, {
        homeScore: sim.homeScore,
        awayScore: sim.awayScore,
        replayUrl: sim.replayUrl,
        pokemonData: sim.pokemonData,
      }, SIM_ACTOR);

      if (!outcome.ok) {
        return {
          success: false,
          error: `recordMatchResult failed for ${fresh.id}: ${outcome.error}`,
          matchesPlayed: played,
          championId: null,
        };
      }
      played++;
    }
  }

  // Champion = winner of the finals match.
  const finals = db.select().from(schema.matches)
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.phase, 'playoffs'),
      eq(schema.matches.playoffRound, 'f'),
    ))
    .get();
  let championId: string | null = null;
  if (finals && finals.homeScore != null && finals.awayScore != null) {
    championId = finals.homeScore > finals.awayScore ? finals.homeTeamId : finals.awayTeamId;
  }

  db.update(schema.leagues)
    .set({ phase: 'offseason' })
    .where(eq(schema.leagues.id, leagueId))
    .run();

  return { success: true, matchesPlayed: played, championId };
}

/**
 * Build a playoff bracket — mirrors `POST /api/leagues/:id/playoffs/generate`
 * (seedings by `computeStandings`, same bracket shapes for 2/4/6/8). Kept here
 * so the simulator doesn't have to round-trip the HTTP route.
 */
function generatePlayoffBracket(leagueId: string): { success: boolean; error?: string } {
  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return { success: false, error: 'League not found' };

  const seedCount = league.playoffTeamCount ?? 6;
  if (![2, 4, 6, 8].includes(seedCount)) {
    return { success: false, error: `Invalid playoffTeamCount ${seedCount}` };
  }

  const teamRecords = computeStandings(leagueId, { phase: 'regular' });
  if (teamRecords.length < seedCount) {
    return { success: false, error: `Need ≥${seedCount} teams, have ${teamRecords.length}` };
  }
  const seeded = teamRecords.slice(0, seedCount);

  return tx(() => {
    db.delete(schema.matches)
      .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'playoffs')))
      .run();

    const maxWeek = db.select().from(schema.matches)
      .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'regular')))
      .all()
      .reduce((m, x) => Math.max(m, x.week), 0);

    const matchups: { round: string; homeSeed: number; awaySeed: number; week: number }[] = [];
    if (seedCount === 8) {
      matchups.push({ round: 'qf', homeSeed: 1, awaySeed: 8, week: maxWeek + 1 });
      matchups.push({ round: 'qf', homeSeed: 4, awaySeed: 5, week: maxWeek + 1 });
      matchups.push({ round: 'qf', homeSeed: 2, awaySeed: 7, week: maxWeek + 1 });
      matchups.push({ round: 'qf', homeSeed: 3, awaySeed: 6, week: maxWeek + 1 });
      matchups.push({ round: 'sf', homeSeed: 0, awaySeed: 0, week: maxWeek + 2 });
      matchups.push({ round: 'sf', homeSeed: 0, awaySeed: 0, week: maxWeek + 2 });
      matchups.push({ round: 'f', homeSeed: 0, awaySeed: 0, week: maxWeek + 3 });
    } else if (seedCount === 6) {
      matchups.push({ round: 'qf', homeSeed: 3, awaySeed: 6, week: maxWeek + 1 });
      matchups.push({ round: 'qf', homeSeed: 4, awaySeed: 5, week: maxWeek + 1 });
      matchups.push({ round: 'sf', homeSeed: 1, awaySeed: 0, week: maxWeek + 2 });
      matchups.push({ round: 'sf', homeSeed: 2, awaySeed: 0, week: maxWeek + 2 });
      matchups.push({ round: 'f', homeSeed: 0, awaySeed: 0, week: maxWeek + 3 });
    } else if (seedCount === 4) {
      matchups.push({ round: 'sf', homeSeed: 1, awaySeed: 4, week: maxWeek + 1 });
      matchups.push({ round: 'sf', homeSeed: 2, awaySeed: 3, week: maxWeek + 1 });
      matchups.push({ round: 'f', homeSeed: 0, awaySeed: 0, week: maxWeek + 2 });
    } else {
      matchups.push({ round: 'f', homeSeed: 1, awaySeed: 2, week: maxWeek + 1 });
    }

    let matchNum = 0;
    for (const m of matchups) {
      matchNum++;
      const homeTeam = m.homeSeed > 0 ? seeded[m.homeSeed - 1]?.id : null;
      const awayTeam = m.awaySeed > 0 ? seeded[m.awaySeed - 1]?.id : null;
      db.insert(schema.matches).values({
        id: `${leagueId}-p${m.round}${matchNum}`,
        leagueId,
        week: m.week,
        homeTeamId: homeTeam ?? null,
        awayTeamId: awayTeam ?? null,
        phase: 'playoffs',
        playoffRound: m.round,
        homeSeed: m.homeSeed || null,
        awaySeed: m.awaySeed || null,
        status: 'scheduled',
      }).run();
    }

    for (let i = 0; i < teamRecords.length; i++) {
      db.update(schema.teams).set({ rank: i + 1 })
        .where(eq(schema.teams.id, teamRecords[i]!.id)).run();
    }

    return { success: true };
  });
}
