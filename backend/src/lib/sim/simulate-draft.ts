/**
 * simulateDraft — AI-driven synthetic draft for the season simulator.
 *
 * Runs a full snake draft for a league by reusing the REAL draft engine:
 * `startDraft` opens the draft, then each slot is filled with `executePick`
 * (skipTurnCheck) so the genuine point-cap / tera-captain-headroom / 1-mega /
 * no-dup-dex validation runs for every pick. A working simulated draft
 * therefore proves the live draft validators.
 *
 * The "AI" is intentionally simple: it gathers every Pokemon that `validatePick`
 * would accept right now and picks one with a tier-weighted bias that decays
 * over the draft (high tiers early, value picks late). After the draft completes
 * it designates tera captains for each team within the cap headroom.
 */
import { db, schema } from '../../db';
import { and, eq } from 'drizzle-orm';
import { tx } from '../tx';
import { effectiveCost } from '../tera-cost';
import { getLeagueCostMap } from '../league-costs';
import {
  startDraft,
  executePick,
  validatePick,
  generateSnakeOrder,
} from '../draft-engine';
import type { MockRng } from './mock-rng';
import { assertMockMode } from './sim-guard';

export interface SimulateDraftResult {
  success: boolean;
  error?: string;
  picks: number;
  captainsAssigned: number;
}

/**
 * Run and complete a synthetic draft for `leagueId`.
 *
 * Preconditions: the league is in phase='draft' with a `draftOrder` set and its
 * teams created. Postconditions: every snake slot filled via the real engine,
 * draft_state.status='completed', and tera captains designated + captainsLocked.
 */
export function simulateDraft(leagueId: string, rng: MockRng): SimulateDraftResult {
  assertMockMode();

  const league = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return { success: false, error: 'League not found', picks: 0, captainsAssigned: 0 };

  const season = db.select().from(schema.seasons)
    .where(eq(schema.seasons.id, league.seasonId))
    .get();
  if (!season) return { success: false, error: 'Season not found', picks: 0, captainsAssigned: 0 };

  const teamOrder: string[] = league.draftOrder ? JSON.parse(league.draftOrder) : [];
  if (teamOrder.length < 2) {
    return { success: false, error: 'Need ≥2 teams in draft order', picks: 0, captainsAssigned: 0 };
  }

  // Open the draft via the real engine (force-restart if a prior draft exists).
  const started = startDraft(leagueId, 120, 'simulator', { force: true });
  if (!started.success) {
    return { success: false, error: started.error, picks: 0, captainsAssigned: 0 };
  }

  const snakeOrder = generateSnakeOrder(teamOrder, league.rosterSize);

  // Candidate pool: all mons with a real (non-banned, non-zero) tier in the
  // league's cost format, sorted high→low. Costs come from the format map so
  // the sim draft honors per-league format overrides (natdex vs natdexplus).
  const leagueCostMap = getLeagueCostMap(leagueId);
  const allPokemon = db.select().from(schema.pokemon).all();
  const pool = allPokemon
    .map(p => {
      const cost = leagueCostMap.get(p.name);
      return { name: p.name, tier: cost?.tier ?? p.tier, banned: cost?.banned ?? p.banned };
    })
    .filter(p => !p.banned && p.tier > 0)
    .sort((a, b) => b.tier - a.tier);

  let picksMade = 0;
  for (let i = 0; i < snakeOrder.length; i++) {
    const slot = snakeOrder[i]!;
    const choice = choosePick(pool, slot.teamId, leagueId, season.pointCap, league.rosterSize, slot.round, rng);
    if (!choice) {
      return {
        success: false,
        error: `No legal pick for ${slot.teamId} at round ${slot.round}`,
        picks: picksMade,
        captainsAssigned: 0,
      };
    }
    const res = executePick(leagueId, choice, slot.teamId, 'simulator', { skipTurnCheck: true });
    if (!res.success) {
      return { success: false, error: res.error, picks: picksMade, captainsAssigned: 0 };
    }
    picksMade++;
  }

  const captainsAssigned = assignCaptains(leagueId, teamOrder, season.teraCaptainSlots, rng);
  return { success: true, picks: picksMade, captainsAssigned };
}

/**
 * Pick a Pokemon for one slot. Scans the pool for picks `validatePick` accepts,
 * then weighted-samples with a high-tier bias that decays across rounds.
 */
function choosePick(
  pool: { name: string; tier: number }[],
  teamId: string,
  leagueId: string,
  pointCap: number,
  rosterSize: number,
  round: number,
  rng: MockRng,
): string | null {
  const legal: { name: string; tier: number }[] = [];
  for (const p of pool) {
    if (validatePick(p.name, teamId, leagueId, pointCap).valid) {
      legal.push(p);
    }
    // Cap the scan once we have a healthy candidate set — the pool is sorted
    // high→low so the first ~60 legal mons already span the realistic range.
    if (legal.length >= 60) break;
  }
  if (legal.length === 0) return null;

  // Early rounds bias hard toward top tiers; late rounds flatten toward value.
  // roundFactor 1.0 at round 1 → ~0.1 by the final round.
  const roundFactor = Math.max(0.1, 1 - (round - 1) / rosterSize);
  const weighted = legal.map(p => ({
    value: p.name,
    weight: Math.pow(Math.max(1, p.tier), 1 + 2 * roundFactor),
  }));
  return rng.weighted(weighted);
}

/**
 * Designate tera captains for every team, choosing eligible mons (tier ≤9, not
 * tera-banned) cheap enough that the marked-up roster still fits the point cap.
 * Picks the highest-tier affordable candidates and sets captainsLocked.
 * Returns the total number of captains assigned across the league.
 */
function assignCaptains(
  leagueId: string,
  teamOrder: string[],
  captainSlots: number,
  rng: MockRng,
): number {
  if (captainSlots <= 0) {
    // Still lock teams so the phase gate can advance.
    tx(() => {
      for (const teamId of teamOrder) {
        db.update(schema.teams).set({ captainsLocked: true })
          .where(eq(schema.teams.id, teamId)).run();
      }
    });
    return 0;
  }

  // Resolve tera-banned status from the league's cost format (not global pokemon.teraBanned).
  const costMap = getLeagueCostMap(leagueId);
  const teraBanned = new Set(
    [...costMap.entries()].filter(([, c]) => c.teraBanned).map(([name]) => name),
  );
  const pointCapRow = db.select().from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId)).get();
  const season = pointCapRow
    ? db.select().from(schema.seasons).where(eq(schema.seasons.id, pointCapRow.seasonId)).get()
    : null;
  const pointCap = season?.pointCap ?? 110;

  const TERA_TYPES = [
    'Fire', 'Water', 'Grass', 'Electric', 'Dragon', 'Fighting', 'Steel',
    'Fairy', 'Ghost', 'Dark', 'Ground', 'Flying', 'Ice', 'Psychic',
  ];

  let total = 0;
  return tx(() => {
    for (const teamId of teamOrder) {
      const roster = db.select().from(schema.rosters)
        .where(and(eq(schema.rosters.teamId, teamId), eq(schema.rosters.acquiredVia, 'draft')))
        .all();
      const baseCost = roster.reduce((s, r) => s + r.costAtDraft, 0);

      // Eligible: tier 1..9, not tera-banned. Prefer highest tier — those are
      // the mons a real captain would pick. Greedily add while cap allows.
      const eligible = roster
        .filter(r => r.tier >= 1 && r.tier <= 9 && !teraBanned.has(r.pokemonName))
        .sort((a, b) => b.tier - a.tier);

      let runningCost = baseCost;
      let assigned = 0;
      for (const mon of eligible) {
        if (assigned >= captainSlots) break;
        const markup = effectiveCost(mon.tier, true) - mon.tier;
        if (runningCost + markup > pointCap) continue;
        runningCost += markup;
        const teras = rng.shuffle(TERA_TYPES).slice(0, 3);
        db.update(schema.rosters).set({
          isTeraCaptain: true,
          teraType1: teras[0],
          teraType2: teras[1],
          teraType3: teras[2],
        }).where(eq(schema.rosters.id, mon.id)).run();
        assigned++;
        total++;
      }

      db.update(schema.teams).set({ captainsLocked: true })
        .where(eq(schema.teams.id, teamId)).run();
    }
    return total;
  });
}
