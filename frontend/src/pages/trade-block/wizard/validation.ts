/**
 * Trade validation — shared between the quick-propose dialog and the multi-step
 * wizard so both surfaces agree on what's legal before the request hits the
 * backend (which re-verifies authoritatively).
 *
 * Rules mirrored:
 *   - point cap (using mon.tier — locked at draft, mirrors backend costAtDraft)
 *   - max 1 mega per team
 *   - no duplicate species (proxy for national-dex check)
 */

import { isMegaForm, getBaseFormName } from '@/lib/draft-rules';
import type { Player, RosterPokemon } from '@/lib/types';

export interface ValidationIssue {
  side: 'offering' | 'requesting';
  message: string;
}

export interface ValidateTradeOpts {
  proposer: Player;
  recipient: Player;
  offering: Set<string>;
  requesting: Set<string>;
  pointCap: number;
}

export function validateTrade(opts: ValidateTradeOpts): ValidationIssue[] {
  const { proposer, recipient, offering, requesting, pointCap } = opts;
  const issues: ValidationIssue[] = [];

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

  function check(side: 'offering' | 'requesting', label: string, roster: RosterPokemon[]) {
    const total = roster.reduce((s, m) => s + (m.tier || 0), 0);
    if (total > pointCap) {
      issues.push({ side, message: `${label} would exceed point cap (${total} > ${pointCap})` });
    }

    const megas = roster.filter(m => isMegaForm(m.name));
    if (megas.length > 1) {
      issues.push({ side, message: `${label} would have ${megas.length} megas (${megas.map(m => m.name).join(', ')}) — max 1` });
    }

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

  check('offering', 'Your team', postProposer);
  check('requesting', recipient.teamAbbrev, postRecipient);

  return issues;
}

/** Sum of tier costs for the named pokemon on a team's roster. */
export function pointDelta(team: Player, names: Set<string>): number {
  return team.roster
    .filter(m => names.has(m.name))
    .reduce((s, m) => s + (m.tier || 0), 0);
}
