/**
 * simulateMatch — synthetic Pokemon-draft match result generator.
 *
 * Pure function: NO database access. Given two rosters and a MockRng it
 * produces a score + per-Pokemon K/D table that the season driver feeds
 * verbatim through `recordMatchResult`.
 *
 * ── Validation contract ──────────────────────────────────────────────────
 * The output MUST pass `validatePokemonData` (match-validation.ts) with zero
 * errors AND zero warnings. The validator's checks, and how we satisfy each:
 *
 *   1. Every entry's teamId ∈ {home, away}        — we only emit those two.
 *   2. Every pokemonName on that team's roster     — we only pick from rosters.
 *   3. homeScore === Σ away-team deaths            — see scoring model below.
 *   4. awayScore === Σ home-team deaths            — see scoring model below.
 *   5. ≤ 6 entries per team                        — we bring exactly 6 each.
 *
 * Scoring model (standard Pokemon draft KO scoring):
 *   - homeScore = number of opposing (away) mons knocked out by home.
 *   - awayScore = number of home mons knocked out by away.
 *   - A team's score therefore equals the opponent's total deaths. So we set
 *     Σ(deaths on away team) = homeScore and Σ(deaths on home team) = awayScore.
 *   - Each brought mon faints 0 or 1 time (singles, no revives) → deaths are a
 *     0/1 flag and exactly `opponentScore` of a team's 6 mons faint.
 *   - The winner reaches 6 KOs (all 6 enemy mons fainted); the loser scores
 *     0..5. So the losing team always has all 6 mons fainted, the winning team
 *     has `loserScore` mons fainted.
 *   - Total kills are distributed so Σ(kills on a team) = opponent deaths, and
 *     overall Σ kills === Σ deaths — internally coherent.
 *
 * simulateMatch self-asserts every invariant before returning.
 */
import type { PokemonDataEntry } from '../match-service';
import type { MockRng } from './mock-rng';

export interface SimRosterMon {
  pokemonName: string;
  tier: number;
}

export interface SimulateMatchInput {
  homeTeamId: string;
  awayTeamId: string;
  homeRoster: SimRosterMon[];
  awayRoster: SimRosterMon[];
  rng: MockRng;
  isPlayoff?: boolean;
}

export interface SimulateMatchResult {
  homeScore: number;
  awayScore: number;
  pokemonData: PokemonDataEntry[];
  replayUrl: string;
}

/** Tera types a synthetic captain might terastallize into. */
const TERA_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting',
  'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost',
  'Dragon', 'Dark', 'Steel', 'Fairy',
];

/** Logistic curve — maps a roster-value delta to a home win probability. */
function winProbability(homeValue: number, awayValue: number): number {
  // Scale chosen so a ~15pt roster-value edge ≈ 70% win odds, and the result
  // is clamped to [0.18, 0.82] so upsets land in the 18-25% band the spec asks
  // for even when one roster massively outvalues the other.
  const delta = homeValue - awayValue;
  const raw = 1 / (1 + Math.exp(-delta / 12));
  return Math.min(0.82, Math.max(0.18, raw));
}

/** Pick `count` distinct mons from a roster, weighted toward higher tier. */
function pickBrought(roster: SimRosterMon[], count: number, rng: MockRng): SimRosterMon[] {
  if (roster.length <= count) return [...roster];
  const pool = [...roster];
  const chosen: SimRosterMon[] = [];
  for (let i = 0; i < count; i++) {
    // Slight high-tier bias: weight = tier + 2 so low tiers still appear.
    const picked = rng.weighted(pool.map(m => ({ value: m, weight: m.tier + 2 })));
    chosen.push(picked);
    pool.splice(pool.indexOf(picked), 1);
  }
  return chosen;
}

/**
 * Distribute `deathCount` faints across `mons` (each mon 0 or 1 death) and
 * `killCount` kills across the OPPOSING side's surviving-weighted mons.
 * Returns death flags aligned to `mons`.
 */
function pickDeathFlags(mons: SimRosterMon[], deathCount: number, rng: MockRng): boolean[] {
  const flags = new Array(mons.length).fill(false);
  if (deathCount >= mons.length) return flags.map(() => true);
  // Lower-tier mons faint slightly more often (weight = 11 - tier).
  const indices = [...mons.keys()];
  const order = rng.shuffle(
    indices.map(i => ({ i, w: Math.max(1, 11 - mons[i]!.tier) })),
  )
    // Stable-ish weighted ordering: sort by random-perturbed weight desc.
    .map(x => ({ i: x.i, k: x.w * (0.5 + rng.next()) }))
    .sort((a, b) => b.k - a.k)
    .map(x => x.i);
  for (let n = 0; n < deathCount; n++) flags[order[n]!] = true;
  return flags;
}

/**
 * Distribute `killCount` kills across `mons`, weighted toward surviving
 * high-tier mons. `survived[i]` true ⇒ that mon was not KO'd.
 */
function distributeKills(
  mons: SimRosterMon[],
  survived: boolean[],
  killCount: number,
  rng: MockRng,
): number[] {
  const kills = new Array(mons.length).fill(0);
  if (killCount <= 0) return kills;
  for (let n = 0; n < killCount; n++) {
    const picked = rng.weighted(
      mons.map((m, i) => ({
        // Survivors that are higher-tier are credited with more KOs; a fainted
        // mon can still have traded a KO before going down, so weight > 0.
        value: i,
        weight: (survived[i] ? m.tier + 3 : 1) + 0.5,
      })),
    );
    kills[picked] += 1;
  }
  return kills;
}

/**
 * Simulate one match. Deterministic for a given (input, rng-state) pair.
 */
export function simulateMatch(input: SimulateMatchInput): SimulateMatchResult {
  const { homeTeamId, awayTeamId, homeRoster, awayRoster, rng } = input;
  if (homeRoster.length === 0 || awayRoster.length === 0) {
    throw new Error('simulateMatch: both rosters must be non-empty');
  }

  // ── Decide the winner ────────────────────────────────────────────────
  const homeValue = homeRoster.reduce((s, m) => s + m.tier, 0);
  const awayValue = awayRoster.reduce((s, m) => s + m.tier, 0);
  const homeWins = rng.next() < winProbability(homeValue, awayValue);

  // ── Brought teams (6 each, or fewer if roster is short) ──────────────
  const broughtHome = pickBrought(homeRoster, Math.min(6, homeRoster.length), rng);
  const broughtAway = pickBrought(awayRoster, Math.min(6, awayRoster.length), rng);

  // ── Score: winner takes a full 6, loser a weighted 0..5 ──────────────
  // Winner's KO count is capped by how many mons the loser actually brought.
  const winnerBrought = homeWins ? broughtHome : broughtAway;
  const loserBrought = homeWins ? broughtAway : broughtHome;
  const winnerScore = loserBrought.length; // KO'd every loser mon
  // Loser score: weighted toward closer games but 6-0 sweeps still happen.
  const maxLoserScore = winnerBrought.length - 1;
  const loserScore = rng.weighted(
    Array.from({ length: maxLoserScore + 1 }, (_, n) => ({
      value: n,
      // Mid-range outcomes (3-4) are the most common.
      weight: [2, 3, 4, 5, 4, 2][n] ?? 1,
    })),
  );

  const homeScore = homeWins ? winnerScore : loserScore;
  const awayScore = homeWins ? loserScore : winnerScore;

  // ── Death flags: a team's faints = opponent's score ──────────────────
  // homeScore KOs inflicted on away ⇒ away has homeScore deaths.
  const awayDeathFlags = pickDeathFlags(broughtAway, homeScore, rng);
  const homeDeathFlags = pickDeathFlags(broughtHome, awayScore, rng);

  // ── Kill distribution ────────────────────────────────────────────────
  // Home team's kills must sum to homeScore (deaths it inflicted on away).
  const homeSurvived = homeDeathFlags.map(d => !d);
  const awaySurvived = awayDeathFlags.map(d => !d);
  const homeKills = distributeKills(broughtHome, homeSurvived, homeScore, rng);
  const awayKills = distributeKills(broughtAway, awaySurvived, awayScore, rng);

  // ── Tera: ~1 mon per team terastallizes ──────────────────────────────
  const homeTeraIdx = rng.bool(0.85) ? rng.int(0, broughtHome.length - 1) : -1;
  const awayTeraIdx = rng.bool(0.85) ? rng.int(0, broughtAway.length - 1) : -1;

  const pokemonData: PokemonDataEntry[] = [];
  broughtHome.forEach((m, i) => {
    pokemonData.push({
      teamId: homeTeamId,
      pokemonName: m.pokemonName,
      kills: homeKills[i]!,
      deaths: homeDeathFlags[i] ? 1 : 0,
      teraUsed: i === homeTeraIdx,
      teraType: i === homeTeraIdx ? rng.pick(TERA_TYPES) : undefined,
    });
  });
  broughtAway.forEach((m, i) => {
    pokemonData.push({
      teamId: awayTeamId,
      pokemonName: m.pokemonName,
      kills: awayKills[i]!,
      deaths: awayDeathFlags[i] ? 1 : 0,
      teraUsed: i === awayTeraIdx,
      teraType: i === awayTeraIdx ? rng.pick(TERA_TYPES) : undefined,
    });
  });

  const result: SimulateMatchResult = {
    homeScore,
    awayScore,
    pokemonData,
    replayUrl: `https://replay.cannoli.live/sim/${homeTeamId}-${awayTeamId}`,
  };

  assertInvariants(result, homeTeamId, awayTeamId);
  return result;
}

/**
 * Self-check: re-derives the same invariants `validatePokemonData` enforces and
 * throws if any is violated. A throw here is a simulator bug, never bad input.
 */
function assertInvariants(
  r: SimulateMatchResult,
  homeTeamId: string,
  awayTeamId: string,
): void {
  let homeDeaths = 0, awayDeaths = 0, homeKills = 0, awayKills = 0;
  let homeCount = 0, awayCount = 0;
  for (const e of r.pokemonData) {
    if (e.teamId !== homeTeamId && e.teamId !== awayTeamId) {
      throw new Error(`simulateMatch invariant: stray teamId ${e.teamId}`);
    }
    if (e.deaths < 0 || e.deaths > 1) {
      throw new Error(`simulateMatch invariant: ${e.pokemonName} deaths=${e.deaths} not 0/1`);
    }
    if (e.kills < 0) {
      throw new Error(`simulateMatch invariant: ${e.pokemonName} negative kills`);
    }
    if (e.teamId === homeTeamId) {
      homeDeaths += e.deaths; homeKills += e.kills; homeCount++;
    } else {
      awayDeaths += e.deaths; awayKills += e.kills; awayCount++;
    }
  }
  if (homeCount > 6 || awayCount > 6) {
    throw new Error(`simulateMatch invariant: brought >6 (home=${homeCount}, away=${awayCount})`);
  }
  // homeScore = KOs home scored = deaths inflicted on away.
  if (r.homeScore !== awayDeaths) {
    throw new Error(`simulateMatch invariant: homeScore=${r.homeScore} ≠ awayDeaths=${awayDeaths}`);
  }
  if (r.awayScore !== homeDeaths) {
    throw new Error(`simulateMatch invariant: awayScore=${r.awayScore} ≠ homeDeaths=${homeDeaths}`);
  }
  // Internal kill coherence: a team's kills equal the opponent's deaths.
  if (homeKills !== awayDeaths) {
    throw new Error(`simulateMatch invariant: homeKills=${homeKills} ≠ awayDeaths=${awayDeaths}`);
  }
  if (awayKills !== homeDeaths) {
    throw new Error(`simulateMatch invariant: awayKills=${awayKills} ≠ homeDeaths=${homeDeaths}`);
  }
}
