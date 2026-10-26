import { DEFAULT_RULESET, parseMarkup, type Ruleset } from '@cannoli/rules';
import type { League, LeagueConfig } from './types';

/** LeagueConfig plus the full ruleset — what team-profile components receive. */
export interface RuleConfig extends LeagueConfig {
  ruleset: Ruleset;
}

type LegacyLeague = {
  costFormat?: string | null;
  season?: { pointCap?: number | null; teraCaptainSlots?: number | null; rosterSize?: number | null } | null;
};

/** Ruleset derived from the pre-ruleset league fields (shared defaults fill the rest). */
export function rulesetFromLegacy(l: LegacyLeague | null | undefined): Ruleset {
  return {
    ...DEFAULT_RULESET,
    costFormat: l?.costFormat ?? DEFAULT_RULESET.costFormat,
    pointCap: l?.season?.pointCap ?? DEFAULT_RULESET.pointCap,
    rosterSize: l?.season?.rosterSize ?? DEFAULT_RULESET.rosterSize,
    teraCaptainSlots: l?.season?.teraCaptainSlots ?? DEFAULT_RULESET.teraCaptainSlots,
  };
}

/** Normalise a wire ruleset (markup may arrive string-keyed); legacy fields fill gaps. */
export function normalizeRuleset(raw: unknown, legacy?: LegacyLeague | null): Ruleset {
  const base = rulesetFromLegacy(legacy);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Ruleset>;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(r)) if (v !== undefined) out[k] = v;
  out.teraMarkup = r.teraMarkup === undefined ? base.teraMarkup : parseMarkup(r.teraMarkup);
  return out as unknown as Ruleset;
}

const cache = new WeakMap<object, Ruleset>();

/** The league's ruleset: `league.ruleset` from the API, else derived from legacy fields. */
export function getLeagueRuleset(league: League | null | undefined): Ruleset {
  if (!league) return DEFAULT_RULESET;
  const hit = cache.get(league);
  if (hit) return hit;
  const rs = normalizeRuleset((league as { ruleset?: unknown }).ruleset, league);
  cache.set(league, rs);
  return rs;
}

export function ruleConfig(league: League | null | undefined): RuleConfig {
  const ruleset = getLeagueRuleset(league);
  return { pointCap: ruleset.pointCap, teraCaptainSlots: ruleset.teraCaptainSlots, ruleset };
}
