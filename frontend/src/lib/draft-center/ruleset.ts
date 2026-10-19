/**
 * Draft Center rulesets are DERIVED from existing leagues — there is no
 * rulesets table. `rulesetFromLeague` is the single seam: when a real table
 * exists, only this module changes (mirrors backend `resolveRuleset`).
 */
import type { League } from '@/lib/types';
import type { CostFormat } from '@/data/tier-list';
import { DEFAULT_FORMAT as DEFAULT_COST_FORMAT } from '@/data/tier-list';
import type { DraftFormat } from '@/data/pokemon-learnsets';
import { DEFAULT_FORMAT as DEFAULT_LEARNSET_FORMAT } from '@/data/pokemon-learnsets';
import { COST_FORMAT_LABELS } from '@/lib/constants';
import { DEFAULT_ROSTER_SIZE, MAX_TERA_TYPES } from './types';

export interface Ruleset {
  id: string;
  label: string;
  leagueId: string | null;
  costFormat: CostFormat;
  /** Move-legality format (learnset scope). */
  learnsetFormat: DraftFormat;
  pointCap: number;
  rosterSize: number;
  teraCaptainSlots: number;
  teraTypesPerCaptain: number;
}

export const DEFAULT_RULESET: Ruleset = {
  id: 'default',
  label: `Default — ${COST_FORMAT_LABELS[DEFAULT_COST_FORMAT]}`,
  leagueId: null,
  costFormat: DEFAULT_COST_FORMAT,
  learnsetFormat: DEFAULT_LEARNSET_FORMAT,
  pointCap: 110,
  rosterSize: DEFAULT_ROSTER_SIZE,
  teraCaptainSlots: 2,
  teraTypesPerCaptain: MAX_TERA_TYPES,
};

export function rulesetFromLeague(league: League): Ruleset {
  const cf = league.costFormat ?? DEFAULT_COST_FORMAT;
  return {
    id: `league:${league.id}`,
    label: `S${league.season.seasonNumber} ${league.name.replace(/ League$/, '')} — ${COST_FORMAT_LABELS[cf] ?? cf}`,
    leagueId: league.id,
    costFormat: cf,
    learnsetFormat: league.format ?? DEFAULT_LEARNSET_FORMAT,
    pointCap: league.season.pointCap,
    rosterSize: league.season.rosterSize,
    teraCaptainSlots: league.season.teraCaptainSlots,
    teraTypesPerCaptain: MAX_TERA_TYPES,
  };
}

/** Resolve a team's ruleset from its league id against the loaded league list. */
export function resolveRuleset(leagueId: string | null, leagues: League[]): Ruleset {
  const l = leagueId ? leagues.find(x => x.id === leagueId) : undefined;
  return l ? rulesetFromLeague(l) : DEFAULT_RULESET;
}
