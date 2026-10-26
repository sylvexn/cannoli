import { fetchJson, rulesetsApi, type ApiRuleset } from '@/lib/api';

/** Rulesets a Draft Center user may pick: templates + the active season's instances. */
export async function fetchPickableRulesets(): Promise<ApiRuleset[]> {
  try {
    return await fetchJson<ApiRuleset[]>('/api/draft-center/rulesets');
  } catch {
    // Public route unavailable (older backend): staff can still use the admin list.
    return rulesetsApi.list().then(l => l.filter(r => !r.archived)).catch(() => []);
  }
}
