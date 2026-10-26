import { DEFAULT_MARKUP, markupCost, rosterBand, validateRulesetShape, type Ruleset, type TeraMarkup } from '@cannoli/rules';
import type { ApiRuleset, ApiRulesetInput } from '@/lib/api';

/** Editor state: nullable numbers become flags so NumberInput always has a number. */
export interface RulesetForm {
  name: string;
  description: string;
  costFormat: string;
  pointCap: number;
  rosterSize: number;
  /** false = use rosterSize (stored as null) */
  customBand: boolean;
  rosterMin: number;
  rosterMax: number;
  /** false = unlimited (stored as null); 0 = no megas */
  megaLimited: boolean;
  megaCap: number;
  teraEnabled: boolean;
  teraCaptainSlots: number;
  teraTypesPerCaptain: number;
  teraMarkup: TeraMarkup;
}

export function toForm(r: Partial<ApiRuleset> & Pick<Ruleset, 'name'>): RulesetForm {
  const size = r.rosterSize ?? 10;
  return {
    name: r.name,
    description: r.description ?? '',
    costFormat: r.costFormat ?? 'natdexplus',
    pointCap: r.pointCap ?? 110,
    rosterSize: size,
    customBand: r.rosterMin != null || r.rosterMax != null,
    rosterMin: r.rosterMin ?? size,
    rosterMax: r.rosterMax ?? size,
    megaLimited: r.megaCap !== null,
    megaCap: r.megaCap ?? 1,
    teraEnabled: r.teraEnabled ?? true,
    teraCaptainSlots: r.teraCaptainSlots ?? 2,
    teraTypesPerCaptain: r.teraTypesPerCaptain ?? 3,
    teraMarkup: { ...(r.teraMarkup ?? DEFAULT_MARKUP) },
  };
}

/** Form -> API body. Unlimited megas -> null; band off -> nulls; tera off -> 0 slots. */
export function toInput(f: RulesetForm): ApiRulesetInput {
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    costFormat: f.costFormat,
    pointCap: f.pointCap,
    rosterSize: f.rosterSize,
    rosterMin: f.customBand ? f.rosterMin : null,
    rosterMax: f.customBand ? f.rosterMax : null,
    megaCap: f.megaLimited ? f.megaCap : null,
    teraEnabled: f.teraEnabled,
    teraCaptainSlots: f.teraEnabled ? f.teraCaptainSlots : 0,
    teraTypesPerCaptain: f.teraTypesPerCaptain,
    teraMarkup: f.teraMarkup,
  };
}

export function formToRuleset(f: RulesetForm): Ruleset {
  const i = toInput(f);
  return { ...(i as Omit<Ruleset, 'id'>), name: i.name ?? '' };
}

export const formErrors = (f: RulesetForm) => validateRulesetShape(formToRuleset(f));

/** Set one tier's captain cost, or remove it (cost = null) to make that tier ineligible. */
export function setMarkup(m: TeraMarkup, tier: number, cost: number | null): TeraMarkup {
  const next = { ...m };
  if (cost === null) delete next[tier]; else next[tier] = cost;
  return next;
}

/** Tier rows 1..max(9, highest key) with base vs captain price. */
export function markupRows(f: Pick<RulesetForm, 'teraEnabled' | 'teraMarkup'>) {
  const top = Math.max(9, ...Object.keys(f.teraMarkup).map(Number));
  return Array.from({ length: top }, (_, i) => {
    const tier = i + 1;
    const eligible = f.teraMarkup[tier] !== undefined;
    const captain = markupCost(f, tier, true);
    return { tier, eligible, captain, delta: captain - tier };
  });
}

/** Worst-case captain headroom + per-mon averages for the cap/roster combo. */
export function budgetPreview(f: RulesetForm) {
  const rows = markupRows(f).filter(r => r.eligible && f.teraEnabled).sort((a, b) => b.delta - a.delta);
  const headroom = rows.slice(0, f.teraCaptainSlots).reduce((s, r) => s + Math.max(0, r.delta), 0);
  const band = rosterBand({
    rosterSize: f.rosterSize,
    rosterMin: f.customBand ? f.rosterMin : null,
    rosterMax: f.customBand ? f.rosterMax : null,
  });
  return {
    headroom,
    avgPerMon: f.pointCap / f.rosterSize,
    avgWithCaptains: (f.pointCap - headroom) / f.rosterSize,
    band,
  };
}

export function summarize(r: Pick<Ruleset, 'costFormat' | 'pointCap' | 'rosterSize' | 'teraEnabled' | 'teraCaptainSlots' | 'megaCap'>): string {
  const mega = r.megaCap === null ? 'unlimited megas' : r.megaCap === 0 ? 'no megas' : `${r.megaCap} mega`;
  const tera = r.teraEnabled ? `${r.teraCaptainSlots} captains` : 'no tera';
  return `${r.costFormat} · ${r.pointCap} pts · ${r.rosterSize} roster · ${tera} · ${mega}`;
}

/**
 * Wizard prefill: the season-level choice fills every league that has no
 * explicit pick (or all of them when `overwrite`). Leagues that left the list drop out.
 */
export function prefillLeagueRulesets(
  leagueIds: string[],
  seasonRulesetId: number | null,
  prev: Record<string, number | null>,
  overwrite = false,
): Record<string, number | null> {
  return Object.fromEntries(leagueIds.map(id => [id, overwrite ? seasonRulesetId : (prev[id] ?? seasonRulesetId)]));
}

/** Payload: only leagues with a chosen ruleset. */
export function rulesetIdsPayload(byLeague: Record<string, number | null>, leagueIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of leagueIds) { const v = byLeague[id]; if (v != null) out[id] = v; }
  return out;
}
