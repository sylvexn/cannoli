/**
 * Trade validation — the single shared pre-flight used by the trade composer
 * so the UI agrees with the backend on what's legal BEFORE the request lands
 * (the backend re-verifies authoritatively).
 *
 * Rules mirrored:
 *   - point cap (using mon.tier — locked at draft, mirrors backend costAtDraft —
 *     with the tera-captain markup applied, same as backend effectiveCost)
 *   - max 1 mega per team
 *   - no duplicate species (proxy for the national-dex check)
 *   - roster band: neither team may exceed its max NOR drop below its min after
 *     the swap (min/max default to the league rosterSize when the band is unset)
 *
 * Unequal (N-for-M) trades are allowed — each side just needs ≥1 and a legal
 * resulting roster.
 *
 * Every side is measured on its PROJECTED roster when `pending` is supplied —
 * approved-but-unapplied FA moves / scheduled trades, straight from the server
 * (GET /api/leagues/:id/pending-moves). A proposal can't land before those do,
 * so that's the roster the backend validator uses too.
 *
 * Lives in lib/ (not under the old wizard/) so every market surface imports the
 * same copy — previously the propose dialog shipped a private fork that drifted.
 */

import { isMegaForm, getBaseFormName } from '@/lib/draft-rules';
import { getTermCost } from '@/data/tier-list';
import type { Player } from '@/lib/types';

/** Server-projected roster for one team (see backend lib/projected-roster.ts). */
export interface PendingMoves {
  /** How many approved-but-unapplied rows fed the projection. */
  moves: number;
  /** Names the pending moves take OFF this roster. */
  outgoing: string[];
  roster: { name: string; tier: number; isTeraCaptain: boolean }[];
}

/** Keyed by team id; teams with nothing pending are absent. */
export type PendingByTeam = Record<string, PendingMoves>;

/** Roster slot — `RosterPokemon` and a projected slot are both assignable. */
type Slot = { name: string; tier: number; isTeraCaptain?: boolean };

/** The roster a proposal will actually meet: projected if pending, else current. */
export function effectiveRoster(team: Player, pending?: PendingByTeam): Slot[] {
  return pending?.[team.id]?.roster ?? team.roster;
}

/** Points a slot contributes — captains carry the tera markup (backend: effectiveCost). */
function slotCost(m: Slot): number {
  const tier = m.tier || 0;
  return m.isTeraCaptain ? getTermCost(tier) : tier;
}

/**
 * Whether trading is closed, mirroring the backend (isTradeDeadlinePassed in
 * lib/queries.ts, and the FA gate in lib/free-agency.ts).
 *
 * `deadlineWeek` is the LAST week trades may be made — a week-7 deadline still
 * trades in week 7, and that trade lands in week 8. Keep this spelled the same
 * way as the backend so the two can't drift again. A non-positive deadline
 * means "no deadline".
 */
export function isTradeDeadlinePassed(currentWeek: number, deadlineWeek: number): boolean {
  if (deadlineWeek <= 0) return false;
  return currentWeek > deadlineWeek;
}

export interface ValidationIssue {
  /** Which side the issue lands on. */
  side: 'offering' | 'requesting';
  message: string;
}

export interface ValidateTradeOpts {
  proposer: Player;
  recipient: Player;
  offering: Set<string>;
  requesting: Set<string>;
  pointCap: number;
  /** League roster band — effective max a side may hold after the swap.
   *  If provided, validates neither side goes over. */
  maxRosterSize?: number;
  /** League roster band — effective min a side may hold after the swap.
   *  If provided, validates neither side falls below. */
  minRosterSize?: number;
  /** Server-projected rosters for teams with scheduled moves. */
  pending?: PendingByTeam;
}

export function validateTrade(opts: ValidateTradeOpts): ValidationIssue[] {
  const { proposer, recipient, offering, requesting, pointCap, maxRosterSize, minRosterSize, pending } = opts;
  const issues: ValidationIssue[] = [];

  // Nothing selected on a side yet → not-yet-legal, but don't nag.
  if (offering.size === 0 || requesting.size === 0) return issues;

  const proposerRoster = effectiveRoster(proposer, pending);
  const recipientRoster = effectiveRoster(recipient, pending);

  // A mon already committed to a scheduled move is gone by the time this trade
  // lands — the backend rejects it, so say so here rather than on submit.
  for (const [side, label, names, roster] of [
    ['offering', 'Your team', offering, proposerRoster],
    ['requesting', recipient.teamAbbrev, requesting, recipientRoster],
  ] as const) {
    for (const name of names) {
      if (!roster.some(m => m.name === name)) {
        issues.push({ side, message: `${label} already has ${name} committed to a scheduled move` });
      }
    }
  }

  const offered = proposerRoster.filter(m => offering.has(m.name));
  const requested = recipientRoster.filter(m => requesting.has(m.name));

  // Build post-trade rosters. Tera captaincy doesn't transfer, so an incoming
  // mon sheds its markup (mirrors backend executeRosterSwap).
  const shed = (m: Slot): Slot => ({ ...m, isTeraCaptain: false });
  const postProposer: Slot[] = [
    ...proposerRoster.filter(m => !offering.has(m.name)),
    ...requested.map(shed),
  ];
  const postRecipient: Slot[] = [
    ...recipientRoster.filter(m => !requesting.has(m.name)),
    ...offered.map(shed),
  ];

  function check(side: 'offering' | 'requesting', label: string, roster: Slot[], max?: number, min?: number) {
    // Roster band (max / min)
    if (max != null && roster.length > max) {
      issues.push({ side, message: `${label} would have ${roster.length} Pokemon (max ${max})` });
    }
    if (min != null && roster.length < min) {
      issues.push({ side, message: `${label} would have ${roster.length} Pokemon (min ${min})` });
    }

    // Point cap
    const total = roster.reduce((s, m) => s + slotCost(m), 0);
    if (total > pointCap) {
      issues.push({ side, message: `${label} would exceed point cap (${total} > ${pointCap})` });
    }

    // Mega cap
    const megas = roster.filter(m => isMegaForm(m.name));
    if (megas.length > 1) {
      issues.push({ side, message: `${label} would have ${megas.length} megas (${megas.map(m => m.name).join(', ')}) — max 1` });
    }

    // Duplicate species
    const baseSeen = new Map<string, string>();
    for (const m of roster) {
      const base = getBaseFormName(m.name);
      const prev = baseSeen.get(base);
      if (prev && prev !== m.name) {
        issues.push({ side, message: `${label} would have duplicate species: ${prev} + ${m.name}` });
        break;
      }
      baseSeen.set(base, m.name);
    }
  }

  check('offering', 'Your team', postProposer, maxRosterSize, minRosterSize);
  check('requesting', recipient.teamAbbrev, postRecipient, maxRosterSize, minRosterSize);

  return issues;
}

/** Sum of effective (captain-marked-up) costs for the named pokemon on a roster. */
export function pointDelta(team: Player, names: Set<string>, pending?: PendingByTeam): number {
  return effectiveRoster(team, pending)
    .filter(m => names.has(m.name))
    .reduce((s, m) => s + slotCost(m), 0);
}

/** Total effective cost of a roster. */
export function rosterTotal(team: Player, pending?: PendingByTeam): number {
  return effectiveRoster(team, pending).reduce((s, m) => s + slotCost(m), 0);
}

export interface SidePoints {
  /** Current roster total. */
  before: number;
  /** Roster total after the swap. */
  after: number;
  /** after − before (positive = took on points). */
  delta: number;
  /** True when `after` breaches the cap. */
  over: boolean;
}

/**
 * Per-side points impact for the live legality meter. `proposer` gives
 * `offering` and receives `requesting`; `recipient` is the mirror.
 */
export function tradePointSummary(
  proposer: Player,
  recipient: Player,
  offering: Set<string>,
  requesting: Set<string>,
  pointCap: number,
  pending?: PendingByTeam,
): { proposer: SidePoints; recipient: SidePoints } {
  // What each side gives up carries its captain markup; what it receives lands
  // as a non-captain, so it only costs base tier.
  const base = (team: Player, names: Set<string>) => effectiveRoster(team, pending)
    .filter(m => names.has(m.name))
    .reduce((s, m) => s + (m.tier || 0), 0);
  const offeringPts = pointDelta(proposer, offering, pending);
  const requestingPts = pointDelta(recipient, requesting, pending);
  const proposerBefore = rosterTotal(proposer, pending);
  const recipientBefore = rosterTotal(recipient, pending);
  const proposerAfter = proposerBefore - offeringPts + base(recipient, requesting);
  const recipientAfter = recipientBefore - requestingPts + base(proposer, offering);
  return {
    proposer: {
      before: proposerBefore,
      after: proposerAfter,
      delta: proposerAfter - proposerBefore,
      over: proposerAfter > pointCap,
    },
    recipient: {
      before: recipientBefore,
      after: recipientAfter,
      delta: recipientAfter - recipientBefore,
      over: recipientAfter > pointCap,
    },
  };
}
