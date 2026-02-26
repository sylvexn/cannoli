/**
 * Draft engine — shared logic for snake draft order, pick validation, and auto-pick.
 * Used by both the real-time draft API and the frontend demo mode (via shared types).
 */

import { db, schema } from '../db';
import { eq, and, asc } from 'drizzle-orm';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SnakePick {
  round: number;
  pick: number;        // 1-indexed within round
  overallPick: number; // 1-indexed global
  teamId: string;
}

export interface DraftConfig {
  leagueId: string;
  teamOrder: string[];   // team IDs in first-round order
  rounds: number;        // typically 10 or 11
  pointCap: number;      // typically 110
  timerDuration: number; // seconds per pick
}

export interface DraftStateSnapshot {
  leagueId: string;
  status: 'not_started' | 'in_progress' | 'paused' | 'completed';
  currentPickIndex: number;
  timerDuration: number;
  timerExpiresAt: string | null; // ISO timestamp
  timerExpiredForTeam: string | null; // teamId whose timer expired (pause-at-1s)
  picks: { teamId: string; pokemonName: string; tier: number; pickNumber: number }[];
  snakeOrder: SnakePick[];
  teamPoints: Record<string, number>; // teamId → points used
}

export interface PickValidation {
  valid: boolean;
  error?: string;
}

// ─── Snake Order Generation ─────────────────────────────────────────────────

/** Generate the full snake-draft pick sequence for N teams × R rounds. */
export function generateSnakeOrder(teamOrder: string[], rounds: number): SnakePick[] {
  const picks: SnakePick[] = [];
  for (let round = 1; round <= rounds; round++) {
    const order = round % 2 === 1 ? teamOrder : [...teamOrder].reverse();
    for (let i = 0; i < order.length; i++) {
      picks.push({
        round,
        pick: i + 1,
        overallPick: picks.length + 1,
        teamId: order[i],
      });
    }
  }
  return picks;
}

// ─── Pick Validation ────────────────────────────────────────────────────────

/**
 * Validate whether a team can draft a specific Pokemon.
 * Returns { valid: true } or { valid: false, error: '...' }.
 */
export function validatePick(
  pokemonName: string,
  teamId: string,
  leagueId: string,
  pointCap: number,
): PickValidation {
  // 1. Pokemon exists and isn't banned
  const poke = db.select().from(schema.pokemon)
    .where(eq(schema.pokemon.name, pokemonName))
    .get();

  if (!poke) return { valid: false, error: `Pokemon "${pokemonName}" not found` };
  if (poke.banned) return { valid: false, error: `${pokemonName} is banned` };

  // 2. Not already drafted in this league
  const existingPick = db.select().from(schema.draftPicks)
    .where(and(
      eq(schema.draftPicks.leagueId, leagueId),
      eq(schema.draftPicks.pokemonName, pokemonName),
    ))
    .get();

  if (existingPick) return { valid: false, error: `${pokemonName} is already drafted` };

  // 3. Point cap check
  const teamPicks = db.select().from(schema.draftPicks)
    .where(and(
      eq(schema.draftPicks.leagueId, leagueId),
      eq(schema.draftPicks.teamId, teamId),
    ))
    .all();

  const usedPoints = teamPicks.reduce((sum, p) => sum + p.tier, 0);
  if (usedPoints + poke.tier > pointCap) {
    return { valid: false, error: `Would exceed point cap (${usedPoints} + ${poke.tier} > ${pointCap})` };
  }

  return { valid: true };
}

// ─── Auto-Pick ──────────────────────────────────────────────────────────────

/**
 * Select a random valid Pokemon for auto-pick (timeout).
 * Picks the highest-tier Pokemon that fits within the remaining budget.
 * Returns null if no valid pick exists (shouldn't happen in practice).
 */
export function getAutoPick(
  teamId: string,
  leagueId: string,
  pointCap: number,
): { name: string; tier: number } | null {
  // Get points already used
  const teamPicks = db.select().from(schema.draftPicks)
    .where(and(
      eq(schema.draftPicks.leagueId, leagueId),
      eq(schema.draftPicks.teamId, teamId),
    ))
    .all();
  const usedPoints = teamPicks.reduce((sum, p) => sum + p.tier, 0);
  const remaining = pointCap - usedPoints;

  // Get all already-drafted pokemon names in this league
  const allPicks = db.select({ name: schema.draftPicks.pokemonName })
    .from(schema.draftPicks)
    .where(eq(schema.draftPicks.leagueId, leagueId))
    .all();
  const drafted = new Set(allPicks.map(p => p.name));

  // Find available pokemon sorted by tier descending
  const available = db.select()
    .from(schema.pokemon)
    .where(eq(schema.pokemon.banned, false))
    .all()
    .filter(p => !drafted.has(p.name) && p.tier > 0 && p.tier <= remaining);

  if (available.length === 0) return null;

  // Pick highest tier available, with some randomness within the top tier
  available.sort((a, b) => b.tier - a.tier);
  const topTier = available[0].tier;
  const topPicks = available.filter(p => p.tier === topTier);
  const chosen = topPicks[Math.floor(Math.random() * topPicks.length)];

  return { name: chosen.name, tier: chosen.tier };
}

// ─── Draft State Operations ─────────────────────────────────────────────────

/** Get the current draft state snapshot for a league. */
export function getDraftSnapshot(leagueId: string): DraftStateSnapshot | null {
  const state = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();

  if (!state) return null;

  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return null;

  const season = db.select().from(schema.seasons)
    .where(eq(schema.seasons.id, league.seasonId))
    .get();
  if (!season) return null;

  const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
  const rounds = season.pointCap > 0 ? 10 : 10; // default 10 rounds

  const snakeOrder = generateSnakeOrder(teamOrder, rounds);

  const picks = db.select().from(schema.draftPicks)
    .where(eq(schema.draftPicks.leagueId, leagueId))
    .orderBy(asc(schema.draftPicks.pickNumber))
    .all()
    .map(p => ({
      teamId: p.teamId,
      pokemonName: p.pokemonName,
      tier: p.tier,
      pickNumber: p.pickNumber,
    }));

  // Compute team points
  const teamPoints: Record<string, number> = {};
  for (const tid of teamOrder) teamPoints[tid] = 0;
  for (const p of picks) {
    teamPoints[p.teamId] = (teamPoints[p.teamId] || 0) + p.tier;
  }

  // Compute timer expiry
  let timerExpiresAt: string | null = null;
  if (state.status === 'in_progress' && state.timerStartedAt) {
    const started = new Date(state.timerStartedAt);
    timerExpiresAt = new Date(started.getTime() + state.timerDuration * 1000).toISOString();
  }

  return {
    leagueId,
    status: state.status,
    currentPickIndex: state.currentPickIndex,
    timerDuration: state.timerDuration,
    timerExpiresAt,
    timerExpiredForTeam: state.timerExpiredForTeam ?? null,
    picks,
    snakeOrder,
    teamPoints,
  };
}

/** Execute a pick: validate, insert, advance state. Returns the pick or error. */
export function executePick(
  leagueId: string,
  pokemonName: string,
  teamId: string,
): { success: true; pick: { teamId: string; pokemonName: string; tier: number; pickNumber: number } } | { success: false; error: string } {
  const state = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();

  if (!state || state.status !== 'in_progress') {
    return { success: false, error: 'Draft is not in progress' };
  }

  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return { success: false, error: 'League not found' };

  const season = db.select().from(schema.seasons)
    .where(eq(schema.seasons.id, league.seasonId))
    .get();
  if (!season) return { success: false, error: 'Season not found' };

  const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
  const snakeOrder = generateSnakeOrder(teamOrder, 10);

  // Check it's the right team's turn
  const currentSlot = snakeOrder[state.currentPickIndex];
  if (!currentSlot) {
    return { success: false, error: 'Draft is already complete' };
  }
  if (currentSlot.teamId !== teamId) {
    return { success: false, error: 'Not your turn' };
  }

  // Validate the pick
  const validation = validatePick(pokemonName, teamId, leagueId, season.pointCap);
  if (!validation.valid) {
    return { success: false, error: validation.error! };
  }

  // Get pokemon tier
  const poke = db.select().from(schema.pokemon)
    .where(eq(schema.pokemon.name, pokemonName))
    .get()!;

  // Insert the draft pick
  const pickNumber = state.currentPickIndex + 1;
  db.insert(schema.draftPicks).values({
    leagueId,
    teamId,
    pickNumber,
    pokemonName,
    tier: poke.tier,
  }).run();

  // Also add to roster
  db.insert(schema.rosters).values({
    teamId,
    pokemonName,
    tier: poke.tier,
    acquiredVia: 'draft',
  }).run();

  // Advance draft state
  const nextIndex = state.currentPickIndex + 1;
  const isComplete = nextIndex >= snakeOrder.length;

  db.update(schema.draftState).set({
    currentPickIndex: nextIndex,
    timerStartedAt: isComplete ? null : new Date().toISOString(),
    status: isComplete ? 'completed' : 'in_progress',
    completedAt: isComplete ? new Date().toISOString() : null,
  }).where(eq(schema.draftState.leagueId, leagueId)).run();

  // If complete, update season phase
  if (isComplete) {
    db.update(schema.seasons).set({ phase: 'regular' })
      .where(eq(schema.seasons.id, league.seasonId)).run();
  }

  return {
    success: true,
    pick: { teamId, pokemonName, tier: poke.tier, pickNumber },
  };
}

/** Start a draft for a league. Validates preconditions. */
export function startDraft(leagueId: string, timerDuration = 120): { success: boolean; error?: string } {
  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return { success: false, error: 'League not found' };

  const season = db.select().from(schema.seasons)
    .where(eq(schema.seasons.id, league.seasonId))
    .get();
  if (!season) return { success: false, error: 'Season not found' };
  if (season.phase !== 'draft') return { success: false, error: `Season is in ${season.phase} phase, not draft` };

  const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
  if (teamOrder.length < 2) return { success: false, error: 'Need at least 2 teams in draft order' };

  // Check no existing active draft
  const existing = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();
  if (existing && existing.status === 'in_progress') {
    return { success: false, error: 'Draft is already in progress' };
  }

  // Clear any previous draft picks for this league (fresh start)
  db.delete(schema.draftPicks).where(eq(schema.draftPicks.leagueId, leagueId)).run();

  // Clear rosters acquired via draft for teams in this league
  const teams = db.select().from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all();
  for (const t of teams) {
    db.delete(schema.rosters).where(and(
      eq(schema.rosters.teamId, t.id),
      eq(schema.rosters.acquiredVia, 'draft'),
    )).run();
  }

  // Upsert draft state
  if (existing) {
    db.update(schema.draftState).set({
      status: 'in_progress',
      currentPickIndex: 0,
      timerDuration,
      timerStartedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      timerExpiredForTeam: null,
    }).where(eq(schema.draftState.leagueId, leagueId)).run();
  } else {
    db.insert(schema.draftState).values({
      leagueId,
      status: 'in_progress',
      currentPickIndex: 0,
      timerDuration,
      timerStartedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    }).run();
  }

  return { success: true };
}

/** Handle timer expiration — pause the draft and flag the team whose timer expired. */
export function handleTimerExpiry(leagueId: string): { paused: true; teamId: string } | null {
  const state = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();
  if (!state || state.status !== 'in_progress') return null;

  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return null;

  const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
  const snakeOrder = generateSnakeOrder(teamOrder, 10);
  const currentSlot = snakeOrder[state.currentPickIndex];
  if (!currentSlot) return null;

  // Pause the draft and record which team's timer expired
  db.update(schema.draftState).set({
    status: 'paused',
    timerStartedAt: null,
    timerExpiredForTeam: currentSlot.teamId,
  }).where(eq(schema.draftState.leagueId, leagueId)).run();

  return { paused: true, teamId: currentSlot.teamId };
}

/** Execute auto-pick for the team whose timer expired, then clear the flag and resume. */
export function executeAutoPick(leagueId: string): ReturnType<typeof executePick> | null {
  const state = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();
  if (!state || state.status !== 'paused' || !state.timerExpiredForTeam) return null;

  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return null;

  const season = db.select().from(schema.seasons)
    .where(eq(schema.seasons.id, league.seasonId))
    .get();
  if (!season) return null;

  // Resume draft so executePick works (it checks for 'in_progress')
  db.update(schema.draftState).set({
    status: 'in_progress',
    timerExpiredForTeam: null,
    timerStartedAt: new Date().toISOString(),
  }).where(eq(schema.draftState.leagueId, leagueId)).run();

  const autoPick = getAutoPick(state.timerExpiredForTeam, leagueId, season.pointCap);
  if (!autoPick) return null;

  return executePick(leagueId, autoPick.name, state.timerExpiredForTeam);
}

/** Skip the current turn (no pick), advance to next pick, clear timer-expired flag. */
export function skipPick(leagueId: string): { success: true } | { success: false; error: string } {
  const state = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();
  if (!state || state.status !== 'paused' || !state.timerExpiredForTeam) {
    return { success: false, error: 'No timer-expired pick to skip' };
  }

  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return { success: false, error: 'League not found' };

  const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
  const snakeOrder = generateSnakeOrder(teamOrder, 10);

  const nextIndex = state.currentPickIndex + 1;
  const isComplete = nextIndex >= snakeOrder.length;

  db.update(schema.draftState).set({
    currentPickIndex: nextIndex,
    status: isComplete ? 'completed' : 'in_progress',
    timerStartedAt: isComplete ? null : new Date().toISOString(),
    timerExpiredForTeam: null,
    completedAt: isComplete ? new Date().toISOString() : null,
  }).where(eq(schema.draftState.leagueId, leagueId)).run();

  if (isComplete) {
    const season = db.select().from(schema.seasons)
      .where(eq(schema.seasons.id, league.seasonId))
      .get();
    if (season) {
      db.update(schema.seasons).set({ phase: 'regular' })
        .where(eq(schema.seasons.id, season.id)).run();
    }
  }

  return { success: true };
}
