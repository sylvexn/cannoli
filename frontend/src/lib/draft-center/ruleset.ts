/**
 * Draft Center teams attach to a ruleset (`rulesetId`). `resolveTeamRuleset`
 * is the single seam that turns a team into a concrete ruleset:
 *   rulesetId -> legacy league's ruleset (for-league) -> league-derived -> DEFAULT_RULESET.
 */
import {
  DEFAULT_RULESET as SHARED_DEFAULT, rosterBand,
  type Ruleset as SharedRuleset,
} from '@cannoli/rules';
import type { League } from '@/lib/types';
import type { ApiRuleset } from '@/lib/api';
import type { CostFormat } from '@/data/tier-list';
import { DEFAULT_FORMAT as DEFAULT_COST_FORMAT } from '@/data/tier-list';
import type { DraftFormat } from '@/data/pokemon-learnsets';
import { DEFAULT_FORMAT as DEFAULT_LEARNSET_FORMAT } from '@/data/pokemon-learnsets';
import { COST_FORMAT_LABELS } from '@/lib/constants';

/** Shared ruleset + the Draft Center extras (display label, move-legality scope). */
export interface Ruleset extends Omit<SharedRuleset, 'costFormat'> {
  costFormat: CostFormat;
  label: string;
  /** Move-legality format (learnset scope). */
  learnsetFormat: DraftFormat;
}

const asCostFormat = (f: string): CostFormat => (f === 'natdex' || f === 'natdexplus' ? f : DEFAULT_COST_FORMAT);

export function toDcRuleset(rs: SharedRuleset, learnsetFormat: DraftFormat = DEFAULT_LEARNSET_FORMAT): Ruleset {
  return { ...rs, costFormat: asCostFormat(rs.costFormat), label: rs.name, learnsetFormat };
}

export const DEFAULT_RULESET: Ruleset = toDcRuleset({ ...SHARED_DEFAULT, teraMarkup: { ...SHARED_DEFAULT.teraMarkup } });

/** Team size = `roster_max ?? roster_size` (NOT a hardcoded 12). */
export const rosterSizeOf = (rs: Pick<SharedRuleset, 'rosterSize' | 'rosterMin' | 'rosterMax'>): number => rosterBand(rs).max;

/** Old pre-ruleset behaviour: build one from a league's season settings. */
function rulesetFromLeague(league: League): Ruleset {
  const cf = asCostFormat(league.costFormat ?? DEFAULT_COST_FORMAT);
  const name = `S${league.season.seasonNumber} ${league.name.replace(/ League$/, '')}`;
  return {
    ...DEFAULT_RULESET,
    id: undefined,
    name,
    label: `${name} — ${COST_FORMAT_LABELS[cf] ?? cf}`,
    costFormat: cf,
    learnsetFormat: league.format ?? DEFAULT_LEARNSET_FORMAT,
    pointCap: league.season.pointCap,
    rosterSize: league.season.rosterSize,
    teraCaptainSlots: league.season.teraCaptainSlots,
  };
}

export interface LeagueRulesetResult { rulesetId: number | null; ruleset: SharedRuleset }

export interface RulesetCatalog {
  /** Pickable rulesets list (templates + active instances). */
  rulesets: ApiRuleset[];
  /** for-league/:id results by league id; null = fetch failed. */
  leagueRulesets: Record<string, LeagueRulesetResult | null>;
  leagues: League[];
}

export const EMPTY_CATALOG: RulesetCatalog = { rulesets: [], leagueRulesets: {}, leagues: [] };

export function resolveTeamRuleset(
  team: { rulesetId?: number | null; leagueId?: string | null },
  cat: RulesetCatalog = EMPTY_CATALOG,
): Ruleset {
  if (team.rulesetId != null) {
    const r = cat.rulesets.find(x => x.id === team.rulesetId);
    if (r) return toDcRuleset(r);
  }
  const lid = team.leagueId;
  if (lid) {
    const league = cat.leagues.find(l => l.id === lid);
    const fl = cat.leagueRulesets[lid];
    if (fl) {
      const listed = fl.rulesetId != null ? cat.rulesets.find(x => x.id === fl.rulesetId) : undefined;
      return toDcRuleset({ ...(listed ?? fl.ruleset), id: fl.rulesetId ?? undefined }, league?.format);
    }
    if (league) return rulesetFromLeague(league);
  }
  return DEFAULT_RULESET;
}
