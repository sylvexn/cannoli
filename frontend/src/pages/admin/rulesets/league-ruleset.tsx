import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { GitFork, Lock, ScrollText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { rulesetsApi, type ApiRuleset } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { summarize } from './form';
import { RulesetSelect, useRulesetTemplates } from './pickers';

/** The league's ruleset: link + summary; assign (template -> fresh instance) in predraft, otherwise fork via the editor. */
export function LeagueRuleset({ leagueId, phase }: { leagueId: string; phase: string }) {
  const predraft = phase === 'predraft';
  const [current, setCurrent] = useState<ApiRuleset | null | undefined>(undefined);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const templates = useRulesetTemplates(predraft);

  const load = useCallback(() => {
    rulesetsApi.forLeague(leagueId)
      .then(r => (r.rulesetId == null ? null : rulesetsApi.get(r.rulesetId)))
      .then(setCurrent)
      .catch(() => setCurrent(null));
  }, [leagueId]);
  useEffect(load, [load]);

  async function assign() {
    if (pick == null) return;
    setBusy(true);
    try { await rulesetsApi.assign(pick, leagueId); toast.success('Ruleset assigned'); setPick(null); load(); }
    catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-xs">
      <ScrollText size={13} className="text-text-muted shrink-0" />
      <div className="min-w-0 flex-1 basis-56">
        {current ? (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <Link to={`/admin/rulesets/${current.id}`} className="truncate min-w-0 text-text-primary hover:underline">{current.name}</Link>
              {current.frozen && <Badge variant="outline" className="gap-1 text-[10px] text-draw border-draw/30 shrink-0"><Lock size={9} />Frozen</Badge>}
            </div>
            <div className="text-[10px] font-mono text-text-muted truncate">{summarize(current)}</div>
          </>
        ) : (
          <span className="text-text-muted">{current === undefined ? 'Loading ruleset...' : 'No ruleset assigned'}</span>
        )}
      </div>
      {predraft ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-44"><RulesetSelect value={pick} options={templates} onChange={setPick} /></div>
          <Button size="sm" variant="outline" className="h-8" onClick={assign} disabled={busy || pick == null}>Assign</Button>
        </div>
      ) : current ? (
        <Link to={`/admin/rulesets/${current.id}`}>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5"><GitFork size={12} />View / fork</Button>
        </Link>
      ) : null}
    </div>
  );
}
