import { useCallback, useEffect, useMemo, useState } from 'react';
import { rulesetsApi, type ApiRuleset } from '@/lib/api';
import { fetchPickableRulesets } from './rulesets-api';
import { useAllLeagues } from './use-all-leagues';
import { resolveTeamRuleset, type LeagueRulesetResult, type Ruleset, type RulesetCatalog } from './ruleset';

let listP: Promise<ApiRuleset[]> | null = null;
const leagueP = new Map<string, Promise<LeagueRulesetResult | null>>();

const loadList = () => (listP ??= fetchPickableRulesets());
function loadLeague(id: string) {
  let p = leagueP.get(id);
  if (!p) { p = rulesetsApi.forLeague(id).catch(() => null); leagueP.set(id, p); }
  return p;
}

type TeamKey = { rulesetId?: number | null; leagueId?: string | null };

/** Loads the pickable rulesets (+ legacy leagues' rulesets for the given teams) and returns a resolver. */
export function useRulesetCatalog(teams: TeamKey[] = []) {
  const { leagues, loading: leaguesLoading } = useAllLeagues();
  const [rulesets, setRulesets] = useState<ApiRuleset[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [leagueRulesets, setLeagueRulesets] = useState<RulesetCatalog['leagueRulesets']>({});

  useEffect(() => {
    let cancelled = false;
    loadList().then(l => { if (!cancelled) setRulesets(l); }).finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const legacyKey = [...new Set(teams.filter(t => t.rulesetId == null && t.leagueId).map(t => t.leagueId!))].sort().join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of legacyKey ? legacyKey.split(',') : []) {
      loadLeague(id).then(v => { if (!cancelled) setLeagueRulesets(p => (id in p ? p : { ...p, [id]: v })); });
    }
    return () => { cancelled = true; };
  }, [legacyKey]);

  const catalog = useMemo<RulesetCatalog>(() => ({ rulesets, leagueRulesets, leagues }), [rulesets, leagueRulesets, leagues]);
  const resolve = useCallback((t: TeamKey): Ruleset => resolveTeamRuleset(t, catalog), [catalog]);
  return { rulesets, resolve, loading: listLoading || leaguesLoading };
}
