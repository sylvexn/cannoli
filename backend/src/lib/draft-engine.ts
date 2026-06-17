/**
 * Draft engine — shared logic for snake draft order, pick validation, and auto-pick.
 * Used by both the real-time draft API and the frontend demo mode (via shared types).
 */

import { db, schema } from '../db';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { tx } from './tx';
import { getBaseFormName } from './pokedex';
import { effectiveCost } from './tera-cost';
import { getLeagueCostMap } from './league-costs';
import { validateRosterLegality } from './roster-legality';

// ─── Structured error codes ────────────────────────────────────────────────
// Mirrors frontend draft-rules ConflictReason kinds — wire-formatted for the
// `code` field on 422 responses so clients can render a translated message.
export type PickErrorCode =
  | 'not_found'
  | 'banned'
  | 'already_drafted'
  | 'dup_species'
  | 'dup_natdex'
  | 'mega_cap'
  | 'over_budget'
  | 'roster_reserve'
  | 'captain_reserve_violation'
  | 'not_in_progress'
  | 'not_your_turn'
  | 'draft_complete'
  | 'league_not_found'
  | 'season_not_found';

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
  /** Per-league budget config — surfaced so the client doesn't hardcode 110. */
  pointCap: number;
  rosterSize: number;
  teraCaptainSlots: number;
}

export interface PickValidation {
  valid: boolean;
  error?: string;
  code?: PickErrorCode;
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

/** Cheapest mon — used to reserve budget for remaining roster slots. */
const MIN_PICK_COST = 1;

/**
 * Worst-case extra points needed to designate `slots` captains from a roster
 * of {name, tier} entries. Tier 9→12, 8→10, 7→9, 6→8, 5→6, 4→5, 3→4, 2→2, 1→1.
 * Mirrors frontend draft-rules.captainHeadroomNeeded: only tier-≤9 mons are
 * eligible, tera-banned mons are excluded, and we sum the highest markups.
 *
 * `leagueId` is used to resolve tera-banned status from the league's cost format
 * rather than the global pokemon table.
 */
export function captainHeadroomNeeded(
  roster: { name: string; tier: number }[],
  slots: number,
  leagueId: string,
): number {
  if (slots <= 0) return 0;
  // Resolve tera-banned flags from the league's cost format map.
  const costs = getLeagueCostMap(leagueId);
  const teraBannedNames = new Set(
    roster.map(r => r.name).filter(name => costs.get(name)?.teraBanned),
  );
  const markups = roster
    .filter(r => r.tier >= 1 && r.tier <= 9 && !teraBannedNames.has(r.name))
    .map(r => Math.max(0, effectiveCost(r.tier, true) - r.tier))
    .sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(slots, markups.length); i++) total += markups[i];
  return total;
}

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

  if (!poke) return { valid: false, error: `Pokemon "${pokemonName}" not found`, code: 'not_found' };

  // Cost/ban resolution uses the league's format map (not the global pokemon.banned).
  const costs = getLeagueCostMap(leagueId);
  const pokeCost = costs.get(pokemonName);
  const pokeBanned = pokeCost?.banned ?? poke.banned;
  const pokeTier = pokeCost?.tier ?? poke.tier;

  if (pokeBanned) return { valid: false, error: `${pokemonName} is banned`, code: 'banned' };

  // 2. Not already drafted in this league
  const existingPick = db.select().from(schema.draftPicks)
    .where(and(
      eq(schema.draftPicks.leagueId, leagueId),
      eq(schema.draftPicks.pokemonName, pokemonName),
    ))
    .get();

  if (existingPick) return { valid: false, error: `${pokemonName} is already drafted`, code: 'already_drafted' };

  // 3. Whole-roster invariants: point cap, ≤1 mega, duplicate natdex, duplicate species.
  // Delegate to the shared validator so these rules can't drift across draft/trade/FA.
  const teamPicks = db.select().from(schema.draftPicks)
    .where(and(
      eq(schema.draftPicks.leagueId, leagueId),
      eq(schema.draftPicks.teamId, teamId),
    ))
    .all();

  // Hydrate all current roster mons in one IN(...) query for the shared validator's
  // pokeByName map (formCategory + nationalDexNumber).
  const rosterNames = teamPicks.map(p => p.pokemonName);
  const rosterMons = rosterNames.length
    ? db.select().from(schema.pokemon).where(inArray(schema.pokemon.name, rosterNames)).all()
    : [];

  // Build the projected post-pick roster for the shared validator.
  // Cost = raw tier (draft context); isTeraCaptain = false (captains designated post-draft).
  const projectedRosterEntries = [
    ...teamPicks.map(p => ({ pokemonName: p.pokemonName, cost: p.tier, isTeraCaptain: false as const })),
    { pokemonName, cost: pokeTier, isTeraCaptain: false as const },
  ];

  // pokeByName map: combines hydrated roster mons + the incoming mon's meta.
  const pokeByName = new Map(rosterMons.map(m => [m.name, {
    formCategory: m.formCategory,
    nationalDexNumber: m.nationalDexNumber,
  }]));
  pokeByName.set(pokemonName, {
    formCategory: poke.formCategory,
    nationalDexNumber: poke.nationalDexNumber,
  });

  const rosterViolation = validateRosterLegality(projectedRosterEntries, pokeByName, { pointCap });
  if (rosterViolation) {
    // Map shared violation codes back to the PickErrorCode wire values the frontend expects,
    // preserving the existing message style exactly.
    const usedPoints = teamPicks.reduce((sum, p) => sum + p.tier, 0);
    if (rosterViolation.code === 'point_cap') {
      return {
        valid: false,
        code: 'over_budget',
        error: `Would exceed point cap (${usedPoints} + ${pokeTier} > ${pointCap})`,
      };
    }
    if (rosterViolation.code === 'mega_cap') {
      return { valid: false, code: 'mega_cap', error: `Max 1 Mega per team — already have one` };
    }
    if (rosterViolation.code === 'dup_natdex') {
      // Find the existing team mon that caused the collision.
      const incomingDex = poke.nationalDexNumber;
      const conflicting = rosterMons.find(m => m.nationalDexNumber != null && m.nationalDexNumber === incomingDex);
      return {
        valid: false,
        code: 'dup_natdex',
        error: `Your team already has ${conflicting?.name ?? 'a Pokémon'} (#${incomingDex}) — only one form of that Pokémon allowed`,
      };
    }
    if (rosterViolation.code === 'dup_species') {
      // Find the existing team mon that shares the same base species.
      const incomingBase = getBaseFormName(pokemonName);
      const conflicting = teamPicks.find(p => getBaseFormName(p.pokemonName) === incomingBase);
      return {
        valid: false,
        code: 'dup_species',
        error: `Your team already has ${conflicting?.pokemonName ?? 'a Pokémon'} (same species as ${pokemonName})`,
      };
    }
    // Fallback (shouldn't happen — all four codes are handled above).
    return { valid: false, code: 'over_budget', error: rosterViolation.message };
  }

  const usedPoints = teamPicks.reduce((sum, p) => sum + p.tier, 0);

  // 5. Roster reservation: must leave (picksLeft - 1) × MIN_PICK_COST for remaining
  // snake slots assigned to this team. Skips when we can't compute picksLeft (e.g.
  // FA pickup paths reusing this function).
  const state = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();
  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  const season = league
    ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get()
    : null;

  if (state && state.status === 'in_progress' && league?.draftOrder) {
    const teamOrder: string[] = JSON.parse(league.draftOrder);
    const snakeOrder = generateSnakeOrder(teamOrder, league.rosterSize);
    const futureSlots = snakeOrder
      .slice(state.currentPickIndex + 1)
      .filter(s => s.teamId === teamId).length;
    const reserve = futureSlots * MIN_PICK_COST;
    const remainingAfter = pointCap - usedPoints - pokeTier;
    if (remainingAfter < reserve) {
      const maxAffordable = pointCap - usedPoints - reserve;
      return {
        valid: false,
        code: 'roster_reserve',
        error: `${pokeTier}pt would leave too little for ${futureSlots} remaining pick${futureSlots === 1 ? '' : 's'} (max ${maxAffordable}pt now)`,
      };
    }

    // 6. Captain-markup reservation: a team must keep enough headroom in pointCap
    // to designate the configured # of captains at marked-up cost. We compute the
    // worst-case markup over the *projected post-pick roster* (current picks +
    // this incoming mon), and require remainingAfter ≥ reserve + futureSlots×MIN.
    const captainSlots = season?.teraCaptainSlots ?? 0;
    if (captainSlots > 0) {
      const projectedRoster = [
        ...teamPicks.map(p => ({ name: p.pokemonName, tier: p.tier })),
        { name: pokemonName, tier: pokeTier },
      ];
      const captainReserve = captainHeadroomNeeded(projectedRoster, captainSlots, leagueId);
      // Need enough left over for both remaining picks (≥ MIN each) AND captain markup.
      const needed = reserve + captainReserve;
      if (remainingAfter < needed) {
        return {
          valid: false,
          code: 'captain_reserve_violation',
          error: `${pokeTier}pt would leave only ${remainingAfter}pt — need ${needed}pt for ${futureSlots} more pick${futureSlots === 1 ? '' : 's'} + ${captainReserve}pt captain markup`,
        };
      }
    }
  }

  return { valid: true };
}

// ─── Auto-Pick ──────────────────────────────────────────────────────────────

/**
 * Select a Pokemon for auto-pick (admin-triggered after a timer expiry pause).
 * Currently picks the highest-tier Pokemon that fits within the remaining
 * budget (with deterministic alphabetical tiebreaker for replay safety).
 *
 * Queue-aware: if the coach has a persisted draft queue (see `setDraftQueue` /
 * the WS `queue` message), auto-pick walks it top-down and selects the first
 * still-eligible/affordable entry. Falls back to highest-tier affordable when
 * the queue is empty or every queued mon is drafted/banned/over-budget/conflicting.
 *
 * Returns null if no valid pick exists (shouldn't happen in practice).
 */
export function getAutoPick(
  teamId: string,
  leagueId: string,
  pointCap: number,
): { name: string; tier: number } | null {
  // Get points already used + same-species set for this team
  const teamPicks = db.select().from(schema.draftPicks)
    .where(and(
      eq(schema.draftPicks.leagueId, leagueId),
      eq(schema.draftPicks.teamId, teamId),
    ))
    .all();
  const usedPoints = teamPicks.reduce((sum, p) => sum + p.tier, 0);
  const remaining = pointCap - usedPoints;

  const teamSpecies = new Set(teamPicks.map(p => getBaseFormName(p.pokemonName)));

  // Hydrate current roster mons once (was two separate per-pick N+1 loops:
  // mega-check + dex-collision).
  const rosterNames = teamPicks.map(p => p.pokemonName);
  const rosterMons = rosterNames.length
    ? db.select().from(schema.pokemon).where(inArray(schema.pokemon.name, rosterNames)).all()
    : [];
  const teamHasMega = rosterMons.some(m => m.formCategory === 'mega');

  // Get all already-drafted pokemon names in this league
  const allPicks = db.select({ name: schema.draftPicks.pokemonName })
    .from(schema.draftPicks)
    .where(eq(schema.draftPicks.leagueId, leagueId))
    .all();
  const drafted = new Set(allPicks.map(p => p.name));

  // Reserve budget for remaining snake slots so auto-pick can't strand a team
  // with picks they can't afford.
  const state = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();
  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  const season = league
    ? db.select().from(schema.seasons).where(eq(schema.seasons.id, league.seasonId)).get()
    : null;
  // Load the league's cost map once — used for banned/tier/teraBanned resolution.
  const costMap = getLeagueCostMap(leagueId);

  let maxAffordable = remaining;
  if (state && state.status === 'in_progress' && league?.draftOrder) {
    const teamOrder: string[] = JSON.parse(league.draftOrder);
    const snakeOrder = generateSnakeOrder(teamOrder, league.rosterSize);
    const futureSlots = snakeOrder
      .slice(state.currentPickIndex + 1)
      .filter(s => s.teamId === teamId).length;
    const captainSlots = season?.teraCaptainSlots ?? 0;
    const captainReserve = captainSlots > 0
      ? captainHeadroomNeeded(teamPicks.map(p => ({ name: p.pokemonName, tier: p.tier })), captainSlots, leagueId)
      : 0;
    maxAffordable = Math.max(0, remaining - futureSlots * MIN_PICK_COST - captainReserve);
  }

  // Pull dex numbers for current team picks so we can also exclude same-natdex
  // collisions — reuse the already-hydrated roster mons.
  const teamDex = new Set<number>();
  for (const m of rosterMons) {
    if (m.nationalDexNumber != null) teamDex.add(m.nationalDexNumber);
  }

  // Eligibility predicate shared by the queue walk and the highest-affordable
  // fallback. A mon is pickable if it's available, affordable within the
  // reserve-adjusted budget, and doesn't violate species/natdex/mega rules.
  // Cost/ban resolution uses the league's format map; form/dex data stays on pokemon.
  const isEligible = (p: typeof schema.pokemon.$inferSelect): boolean => {
    const cost = costMap.get(p.name);
    const effectiveBanned = cost?.banned ?? p.banned;
    const effectiveTier = cost?.tier ?? p.tier;
    if (effectiveBanned) return false;
    if (drafted.has(p.name)) return false;
    if (effectiveTier <= 0 || effectiveTier > maxAffordable) return false;
    if (teamSpecies.has(getBaseFormName(p.name))) return false;
    if (p.nationalDexNumber != null && teamDex.has(p.nationalDexNumber)) return false;
    if (teamHasMega && p.formCategory === 'mega') return false;
    return true;
  };

  // 1. Queue-aware: honor the coach's pre-set order. Walk it top-down and take
  // the first still-eligible entry. Hydrate the queued mons in one IN(...).
  const queued = getDraftQueue(leagueId, teamId);
  if (queued.length > 0) {
    const queuedMons = db.select().from(schema.pokemon)
      .where(inArray(schema.pokemon.name, queued)).all();
    const byName = new Map(queuedMons.map(m => [m.name, m]));
    for (const name of queued) {
      const mon = byName.get(name);
      if (mon && isEligible(mon)) {
        const effectiveTier = costMap.get(mon.name)?.tier ?? mon.tier;
        return { name: mon.name, tier: effectiveTier };
      }
    }
    // Queue exhausted / all invalid → fall through to highest-affordable.
  }

  // 2. Fallback: highest-tier affordable, alphabetical tiebreaker (deterministic
  // — important for pick idempotency / replay).
  // Pull all mons from pokemon table (for form/dex data) then apply isEligible
  // which uses costMap for the ban/tier check.
  const available = db.select()
    .from(schema.pokemon)
    .all()
    .filter(isEligible);

  if (available.length === 0) return null;

  available.sort((a, b) => {
    const tierA = costMap.get(a.name)?.tier ?? a.tier;
    const tierB = costMap.get(b.name)?.tier ?? b.tier;
    return tierB - tierA || a.name.localeCompare(b.name);
  });
  const best = available[0];
  return { name: best.name, tier: costMap.get(best.name)?.tier ?? best.tier };
}

// ─── Draft Queue (per-team auto-pick preference list) ────────────────────────

/** Max queued mons per team. Mirrors the frontend reducer cap (draftQueue ≤ 3). */
export const DRAFT_QUEUE_LIMIT = 3;

/** Read a team's persisted draft queue, ordered by position. */
export function getDraftQueue(leagueId: string, teamId: string): string[] {
  return db.select({ name: schema.draftQueue.pokemonName })
    .from(schema.draftQueue)
    .where(and(
      eq(schema.draftQueue.leagueId, leagueId),
      eq(schema.draftQueue.teamId, teamId),
    ))
    .orderBy(asc(schema.draftQueue.position))
    .all()
    .map(r => r.name);
}

/**
 * Replace a team's draft queue wholesale with `names` (deduped, capped at
 * DRAFT_QUEUE_LIMIT, order preserved). Atomic — delete + re-insert in one tx.
 */
export function setDraftQueue(leagueId: string, teamId: string, names: string[]): string[] {
  const seen = new Set<string>();
  const clean = names.filter(n => typeof n === 'string' && n.trim() && !seen.has(n) && seen.add(n))
    .slice(0, DRAFT_QUEUE_LIMIT);
  return tx(() => {
    db.delete(schema.draftQueue).where(and(
      eq(schema.draftQueue.leagueId, leagueId),
      eq(schema.draftQueue.teamId, teamId),
    )).run();
    clean.forEach((name, i) => {
      db.insert(schema.draftQueue).values({ leagueId, teamId, position: i, pokemonName: name }).run();
    });
    return clean;
  });
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
  const rounds = league.rosterSize;

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
    pointCap: season.pointCap,
    rosterSize: league.rosterSize,
    teraCaptainSlots: season.teraCaptainSlots,
  };
}

type ExecutePickResult =
  | { success: true; pick: { teamId: string; pokemonName: string; tier: number; pickNumber: number } }
  | { success: false; error: string; code?: PickErrorCode };

/**
 * Core pick logic WITHOUT opening a transaction. The caller MUST already be
 * inside a `tx()` (or accept non-atomic execution). Extracted so `executeAutoPick`
 * — which opens its own tx to resume + auto-pick atomically — can run the pick
 * inline instead of nesting a second `tx()`. `lib/tx.ts` has no savepoint
 * nesting, so a nested `tx()` would run inside the outer one and a throw after
 * the outer mutated draftState could partial-commit. See executePick/executeAutoPick.
 */
function _executePickUnlocked(
  leagueId: string,
  pokemonName: string,
  teamId: string,
  actor?: string,
  opts?: { skipTurnCheck?: boolean },
): ExecutePickResult {
  {
    const state = db.select().from(schema.draftState)
      .where(eq(schema.draftState.leagueId, leagueId))
      .get();

    if (!state || state.status !== 'in_progress') {
      return { success: false as const, error: 'Draft is not in progress', code: 'not_in_progress' as const };
    }

    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .get();
    if (!league) return { success: false as const, error: 'League not found', code: 'league_not_found' as const };

    const season = db.select().from(schema.seasons)
      .where(eq(schema.seasons.id, league.seasonId))
      .get();
    if (!season) return { success: false as const, error: 'Season not found', code: 'season_not_found' as const };

    const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
    const snakeOrder = generateSnakeOrder(teamOrder, league.rosterSize);

    // Check it's the right team's turn (skipped for staff-override force-picks)
    const currentSlot = snakeOrder[state.currentPickIndex];
    if (!currentSlot) {
      return { success: false as const, error: 'Draft is already complete', code: 'draft_complete' as const };
    }
    if (!opts?.skipTurnCheck && currentSlot.teamId !== teamId) {
      return { success: false as const, error: 'Not your turn', code: 'not_your_turn' as const };
    }

    // Validate the pick
    const validation = validatePick(pokemonName, teamId, leagueId, season.pointCap);
    if (!validation.valid) {
      return { success: false as const, error: validation.error!, code: validation.code };
    }

    // Resolve this pick's tier from the league's cost format (not the global pokemon.tier).
    // This snapshot is what gets frozen into draftPicks.tier and rosters.costAtDraft.
    const pickCosts = getLeagueCostMap(leagueId);
    const resolvedTier = pickCosts.get(pokemonName)?.tier ?? 0;

    // Insert the draft pick
    const pickNumber = state.currentPickIndex + 1;
    db.insert(schema.draftPicks).values({
      leagueId,
      teamId,
      pickNumber,
      pokemonName,
      tier: resolvedTier,
    }).run();

    // Also add to roster — snapshot costAtDraft from the league's format so later
    // admin tier-list edits don't retroactively shift point totals.
    db.insert(schema.rosters).values({
      teamId,
      pokemonName,
      tier: resolvedTier,
      costAtDraft: resolvedTier,
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

    // Note: we do NOT advance the league phase here. Drafts now hold in
    // phase='draft' (with draftState.status='completed') until every team has
    // locked their tera captains. PUT /api/teams/:teamId/tera-captains
    // performs the final transition once all teams are captainsLocked=true.

    db.insert(schema.activityLog).values({
      type: 'draft_pick',
      category: 'draft',
      actor: actor || teamId,
      leagueId,
      description: `${teamId} picked ${pokemonName} (tier ${resolvedTier})`,
      metadata: JSON.stringify({ pickNumber, teamId, pokemonName, tier: resolvedTier }),
    }).run();

    if (isComplete) {
      db.insert(schema.activityLog).values({
        type: 'draft_completed',
        category: 'draft',
        actor: actor || 'system',
        leagueId,
        description: `Draft completed`,
        metadata: JSON.stringify({ totalPicks: snakeOrder.length }),
      }).run();
    }

    return {
      success: true as const,
      pick: { teamId, pokemonName, tier: resolvedTier, pickNumber },
    };
  }
}

/** Execute a pick: validate, insert, advance state. Returns the pick or error. */
export function executePick(
  leagueId: string,
  pokemonName: string,
  teamId: string,
  actor?: string,
  opts?: { skipTurnCheck?: boolean },
): ExecutePickResult {
  return tx(() => _executePickUnlocked(leagueId, pokemonName, teamId, actor, opts));
}

/**
 * Start a draft for a league. Validates preconditions.
 *
 * Important: starting a draft wipes existing draft picks + draft-acquired
 * roster entries for this league. We refuse to do that on a draft that's
 * already `completed` or `paused` unless the caller passes `{ force: true }`,
 * since the natural admin flow (start → pick → finish) shouldn't ever land
 * back here, and an accidental call would silently destroy the entire draft.
 */
export function startDraft(
  leagueId: string,
  timerDuration = 120,
  actor?: string,
  opts?: { force?: boolean },
): { success: boolean; error?: string; code?: 'completed_draft_requires_force' | 'paused_draft_requires_force' } {
  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return { success: false, error: 'League not found' };

  if (league.phase !== 'draft') return { success: false, error: `League is in ${league.phase} phase, not draft` };

  const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
  if (teamOrder.length < 2) return { success: false, error: 'Need at least 2 teams in draft order' };

  // Check no existing active draft
  const existing = db.select().from(schema.draftState)
    .where(eq(schema.draftState.leagueId, leagueId))
    .get();
  if (existing && existing.status === 'in_progress') {
    return { success: false, error: 'Draft is already in progress' };
  }

  // A completed draft has full rosters + activity log entries — restarting
  // would delete all of that. Force flag (admin-only) bypasses the guard.
  if (existing && existing.status === 'completed' && !opts?.force) {
    return {
      success: false,
      error: 'Draft has already completed for this league. Pass { force: true } to wipe rosters and restart.',
      code: 'completed_draft_requires_force',
    };
  }
  if (existing && existing.status === 'paused' && !opts?.force) {
    return {
      success: false,
      error: 'Draft is paused. Use /resume to continue, or pass { force: true } to wipe rosters and restart.',
      code: 'paused_draft_requires_force',
    };
  }

  return tx(() => {
    // Clear any previous draft picks for this league (fresh start)
    db.delete(schema.draftPicks).where(eq(schema.draftPicks.leagueId, leagueId)).run();

    // Clear rosters acquired via draft for teams in this league + reset their
    // captainsLocked flags so the post-draft captain gate runs fresh.
    const teams = db.select().from(schema.teams)
      .where(eq(schema.teams.leagueId, leagueId))
      .all();
    for (const t of teams) {
      db.delete(schema.rosters).where(and(
        eq(schema.rosters.teamId, t.id),
        eq(schema.rosters.acquiredVia, 'draft'),
      )).run();
    }
    db.update(schema.teams)
      .set({ captainsLocked: false })
      .where(eq(schema.teams.leagueId, leagueId))
      .run();

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

    db.insert(schema.activityLog).values({
      type: 'draft_started',
      category: 'draft',
      actor: actor || 'system',
      leagueId,
      description: `Draft started for ${league.name}`,
      metadata: JSON.stringify({ teamOrder, timerDuration }),
    }).run();

    return { success: true };
  });
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
  const snakeOrder = generateSnakeOrder(teamOrder, league.rosterSize);
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
export function executeAutoPick(leagueId: string, actor?: string): ReturnType<typeof executePick> | null {
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

  return tx(() => {
    // Resume draft so executePick works (it checks for 'in_progress')
    db.update(schema.draftState).set({
      status: 'in_progress',
      timerExpiredForTeam: null,
      timerStartedAt: new Date().toISOString(),
    }).where(eq(schema.draftState.leagueId, leagueId)).run();

    const autoPick = getAutoPick(state.timerExpiredForTeam!, leagueId, season.pointCap);
    if (!autoPick) {
      throw new Error('No valid auto-pick available');
    }

    // Already inside this tx() — call the unlocked core directly. Nesting a
    // second tx() would (with lib/tx.ts's non-savepoint impl) run inside this
    // one, so a later throw could partial-commit the draftState mutation above.
    return _executePickUnlocked(leagueId, autoPick.name, state.timerExpiredForTeam!, actor || 'auto-pick');
  });
}

/**
 * Skip the current turn (no pick), advance to next pick, clear timer-expired flag.
 * `opts.force` allows staff to skip even when not in the post-expiry paused state.
 */
export function skipPick(
  leagueId: string,
  actor?: string,
  opts?: { force?: boolean },
): { success: true } | { success: false; error: string } {
  return tx(() => {
    const state = db.select().from(schema.draftState)
      .where(eq(schema.draftState.leagueId, leagueId))
      .get();
    if (!state) return { success: false as const, error: 'Draft not found' };

    const expired = state.status === 'paused' && !!state.timerExpiredForTeam;
    if (!opts?.force && !expired) {
      return { success: false as const, error: 'No timer-expired pick to skip' };
    }
    if (opts?.force && state.status !== 'in_progress' && !expired) {
      return { success: false as const, error: 'Draft is not active' };
    }

    const league = db.select().from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .get();
    if (!league) return { success: false as const, error: 'League not found' };

    const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
    const snakeOrder = generateSnakeOrder(teamOrder, league.rosterSize);

    const currentSlot = snakeOrder[state.currentPickIndex];
    const skippedTeam = state.timerExpiredForTeam ?? currentSlot?.teamId ?? 'unknown';
    const nextIndex = state.currentPickIndex + 1;
    const isComplete = nextIndex >= snakeOrder.length;

    db.update(schema.draftState).set({
      currentPickIndex: nextIndex,
      status: isComplete ? 'completed' : 'in_progress',
      timerStartedAt: isComplete ? null : new Date().toISOString(),
      timerExpiredForTeam: null,
      completedAt: isComplete ? new Date().toISOString() : null,
    }).where(eq(schema.draftState.leagueId, leagueId)).run();

    // Phase advance is deferred to the captain-lock step (see executePick).

    db.insert(schema.activityLog).values({
      type: 'draft_pick_skipped',
      category: 'draft',
      actor: actor || 'system',
      leagueId,
      description: `Skipped pick for ${skippedTeam}`,
      metadata: JSON.stringify({ teamId: skippedTeam, pickIndex: state.currentPickIndex }),
    }).run();

    return { success: true as const };
  });
}

/**
 * Undo the most recent draft pick: removes the draft_picks row + matching roster
 * entry, decrements currentPickIndex, restores 'in_progress' status, and resets
 * the timer for the team that just had its pick reverted.
 */
export function undoLastPick(
  leagueId: string,
  actor?: string,
): { success: true; undonePick: { teamId: string; pokemonName: string; tier: number; pickNumber: number } } | { success: false; error: string } {
  return tx(() => {
    const state = db.select().from(schema.draftState)
      .where(eq(schema.draftState.leagueId, leagueId))
      .get();
    if (!state) return { success: false as const, error: 'Draft not found' };
    if (state.currentPickIndex <= 0) {
      return { success: false as const, error: 'No picks to undo' };
    }

    // Find the highest-pickNumber pick for this league.
    const last = db.select().from(schema.draftPicks)
      .where(eq(schema.draftPicks.leagueId, leagueId))
      .orderBy(desc(schema.draftPicks.pickNumber))
      .limit(1)
      .get();
    if (!last) return { success: false as const, error: 'No picks to undo' };

    // Remove draft_picks row + matching roster entry (most-recently-acquired
    // draft entry for this team for this Pokemon).
    db.delete(schema.draftPicks)
      .where(eq(schema.draftPicks.id, last.id))
      .run();

    const rosterMatch = db.select().from(schema.rosters)
      .where(and(
        eq(schema.rosters.teamId, last.teamId),
        eq(schema.rosters.pokemonName, last.pokemonName),
        eq(schema.rosters.acquiredVia, 'draft'),
      ))
      .orderBy(desc(schema.rosters.id))
      .limit(1)
      .get();
    if (rosterMatch) {
      db.delete(schema.rosters).where(eq(schema.rosters.id, rosterMatch.id)).run();
    }

    // Rewind state. If the draft had completed, flip back to in_progress and
    // bump the season phase back to draft (it auto-advances on completion).
    const wasComplete = state.status === 'completed';
    db.update(schema.draftState).set({
      currentPickIndex: state.currentPickIndex - 1,
      status: 'in_progress',
      timerStartedAt: new Date().toISOString(),
      timerExpiredForTeam: null,
      completedAt: null,
    }).where(eq(schema.draftState.leagueId, leagueId)).run();

    if (wasComplete) {
      // Pre-captain-lock change: phase used to auto-advance on draft completion,
      // so undo had to flip it back. Now phase only moves to 'regular' once
      // every team in the league has captainsLocked=true. Defensive reset
      // covers the (now unlikely) case that phase did get advanced.
      db.update(schema.leagues).set({ phase: 'draft', currentWeek: 0 })
        .where(eq(schema.leagues.id, leagueId)).run();
      db.update(schema.teams)
        .set({ captainsLocked: false })
        .where(eq(schema.teams.leagueId, leagueId))
        .run();
    }

    db.insert(schema.activityLog).values({
      type: 'draft_pick_undone',
      category: 'admin',
      actor: actor || 'system',
      leagueId,
      description: `Undid pick: ${last.teamId} → ${last.pokemonName} (pick #${last.pickNumber})`,
      metadata: JSON.stringify({
        teamId: last.teamId,
        pokemonName: last.pokemonName,
        tier: last.tier,
        pickNumber: last.pickNumber,
      }),
    }).run();

    return {
      success: true as const,
      undonePick: {
        teamId: last.teamId,
        pokemonName: last.pokemonName,
        tier: last.tier,
        pickNumber: last.pickNumber,
      },
    };
  });
}
