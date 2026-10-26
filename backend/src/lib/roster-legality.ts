import { getBaseFormName } from './pokedex';
import { DEFAULT_RULESET, markupCost, megaLimit, type Ruleset } from '@cannoli/rules';

/**
 * Single source of truth for whole-roster legality.
 *
 * Before this existed the same four invariants — point cap, ≤1 mega, no
 * duplicate national-dex number, no duplicate species/base-form — were
 * hand-written three times (draft `validatePick`, trade `validateProposedTrade`,
 * free-agent pickup) and had drifted: only the draft engine checked the
 * species/base-form collision, so a trade or FA pickup could hand a team
 * `Tornadus` + `Tornadus-Therian` (same base species, different dex #) which the
 * draft forbids. Route everything through this so the rules can never diverge.
 *
 * Callers resolve `cost` themselves because the right price depends on context
 * (draft = raw tier, trade/FA = frozen `costAtDraft` snapshot falling back to
 * the league format cost). This function only applies the captain markup via
 * the ruleset's `markupCost` and sums.
 *
 * It validates the FULL projected post-action roster. The draft engine keeps its
 * own incremental roster-reserve / captain-headroom checks on top — those are
 * draft-specific and not part of these four shared invariants.
 */

export type RosterEntry = {
  pokemonName: string;
  /** Resolved base cost (caller picks costAtDraft vs league cost vs tier). */
  cost: number;
  /** Whether this slot is a designated tera captain (drives the cost markup). */
  isTeraCaptain?: boolean;
};

export type PokeMeta = {
  formCategory?: string | null;
  nationalDexNumber?: number | null;
};

export type RosterViolationCode =
  | 'point_cap'
  | 'mega_cap'
  | 'dup_natdex'
  | 'dup_species';

export type RosterViolation = {
  code: RosterViolationCode;
  message: string;
};

/**
 * Returns the first invariant violation in `roster`, or null if it is legal.
 *
 * @param roster      the full projected roster after the action
 * @param pokeByName  name -> { formCategory, nationalDexNumber } metadata lookup
 * @param opts.ruleset   the league's ruleset (markup table, default point/mega caps)
 * @param opts.pointCap  override of ruleset.pointCap (admin passes Infinity to isolate checks)
 * @param opts.megaCap   override of ruleset.megaCap (null = unlimited)
 * @param opts.label     optional prefix for messages, e.g. a team name / side
 */
export function validateRosterLegality(
  roster: RosterEntry[],
  pokeByName: Map<string, PokeMeta>,
  opts: {
    ruleset?: Pick<Ruleset, 'teraEnabled' | 'teraMarkup' | 'megaCap' | 'pointCap'>;
    pointCap?: number;
    megaCap?: number;
    label?: string;
  },
): RosterViolation | null {
  const rs = opts.ruleset ?? DEFAULT_RULESET;
  const megaCap = opts.megaCap ?? megaLimit(rs);
  const pointCap = opts.pointCap ?? rs.pointCap;
  const label = opts.label ? `${opts.label} ` : '';

  // Point cap — sum effective (captain-marked-up) costs.
  const total = roster.reduce(
    (sum, r) => sum + markupCost(rs, r.cost, !!r.isTeraCaptain),
    0,
  );
  if (total > pointCap) {
    return {
      code: 'point_cap',
      message: `${label}would exceed point cap (${total} > ${pointCap})`,
    };
  }

  let megaCount = 0;
  const dexSeen = new Map<number, string>();
  const speciesSeen = new Map<string, string>();

  for (const r of roster) {
    const meta = pokeByName.get(r.pokemonName);

    if (meta?.formCategory === 'mega') megaCount++;

    // Duplicate species / base-form (e.g. Tornadus + Tornadus-Therian).
    const base = getBaseFormName(r.pokemonName);
    const prevSpecies = speciesSeen.get(base);
    if (prevSpecies !== undefined) {
      return {
        code: 'dup_species',
        message: `${label}would have two of the same species (${prevSpecies} + ${r.pokemonName})`,
      };
    }
    speciesSeen.set(base, r.pokemonName);

    // Duplicate national-dex number.
    if (meta?.nationalDexNumber != null) {
      const prevDex = dexSeen.get(meta.nationalDexNumber);
      if (prevDex !== undefined) {
        return {
          code: 'dup_natdex',
          message: `${label}would have duplicate dex#${meta.nationalDexNumber} (${prevDex} + ${r.pokemonName})`,
        };
      }
      dexSeen.set(meta.nationalDexNumber, r.pokemonName);
    }
  }

  if (megaCount > megaCap) {
    return {
      code: 'mega_cap',
      message: `${label}would have ${megaCount} megas (max ${megaCap})`,
    };
  }

  return null;
}
