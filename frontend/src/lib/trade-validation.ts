/**
 * Trade validation — the single shared pre-flight used by the trade composer
 * so the UI agrees with the backend on what's legal BEFORE the request lands
 * (the backend re-verifies authoritatively).
 *
 * Rules mirrored:
 *   - point cap (using mon.tier — locked at draft, mirrors backend costAtDraft)
 *   - max 1 mega per team
 *   - no duplicate species (proxy for the national-dex check)
 *   - roster size: neither team may exceed their roster cap after the swap
 *
 * Unequal (N-for-M) trades are allowed — each side just needs ≥1 and a legal
 * resulting roster.
 *
 * Lives in lib/ (not under the old wizard/) so every market surface imports the
 * same copy — previously the propose dialog shipped a private fork that drifted.
 */

import { isMegaForm, getBaseFormName } from '@/lib/draft-rules';
import type { Player, RosterPokemon } from '@/lib/types';

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
  /** League roster size cap. If provided, validates neither side goes over. */
  rosterSize?: number;
}

export function validateTrade(opts: ValidateTradeOpts): ValidationIssue[] {
  const { proposer, recipient, offering, requesting, pointCap, rosterSize } = opts;
  const issues: ValidationIssue[] = [];

  // Nothing selected on a side yet → not-yet-legal, but don't nag.
  if (offering.size === 0 || requesting.size === 0) return issues;

  const offered = proposer.roster.filter(m => offering.has(m.name));
  const requested = recipient.roster.filter(m => requesting.has(m.name));

  // Build post-trade rosters
  const postProposer: RosterPokemon[] = [
    ...proposer.roster.filter(m => !offering.has(m.name)),
    ...requested,
  ];
  const postRecipient: RosterPokemon[] = [
    ...recipient.roster.filter(m => !requesting.has(m.name)),
    ...offered,
  ];

  function check(side: 'offering' | 'requesting', label: string, roster: RosterPokemon[], rosterMax?: number) {
    // Roster size
    if (rosterMax != null && roster.length > rosterMax) {
      issues.push({ side, message: `${label} would have ${roster.length} Pokemon (max ${rosterMax})` });
    }

    // Point cap
    const total = roster.reduce((s, m) => s + (m.tier || 0), 0);
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

  check('offering', 'Your team', postProposer, rosterSize);
  check('requesting', recipient.teamAbbrev, postRecipient, rosterSize);

  return issues;
}

/** Sum of tier costs for the named pokemon on a team's roster. */
export function pointDelta(team: Player, names: Set<string>): number {
  return team.roster
    .filter(m => names.has(m.name))
    .reduce((s, m) => s + (m.tier || 0), 0);
}

/** Total tier cost of a roster. */
export function rosterTotal(team: Player): number {
  return team.roster.reduce((s, m) => s + (m.tier || 0), 0);
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
): { proposer: SidePoints; recipient: SidePoints } {
  const offeringPts = pointDelta(proposer, offering);
  const requestingPts = pointDelta(recipient, requesting);
  const proposerBefore = rosterTotal(proposer);
  const recipientBefore = rosterTotal(recipient);
  const proposerAfter = proposerBefore - offeringPts + requestingPts;
  const recipientAfter = recipientBefore - requestingPts + offeringPts;
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
