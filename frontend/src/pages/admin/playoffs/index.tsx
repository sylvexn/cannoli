import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Loader2, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';
import { playoffsApi, type PlayoffOverviewRow } from '@/lib/api-playoffs';
import { AdminSection } from '../admin-section';
import { PlayoffEditor } from './editor';

function stateBadge(r: PlayoffOverviewRow) {
  if (r.legacyBracket) return { text: r.locked ? 'bracket live' : 'bracket generated', cls: 'border-win/40 text-win' };
  if (r.status === 'published') return { text: r.locked ? 'published - locked' : 'published', cls: 'border-win/40 text-win' };
  if (r.status === 'draft') return { text: 'draft', cls: 'border-draw/40 text-draw' };
  return { text: 'no draft', cls: 'border-border-subtle text-text-muted' };
}

/** /admin/playoffs - per-league draft list; `?league=ID` opens the seeding editor. */
export function AdminPlayoffs() {
  const [params, setParams] = useSearchParams();
  const leagueId = params.get('league');
  const [rows, setRows] = useState<PlayoffOverviewRow[] | null>(null);

  useEffect(() => {
    if (leagueId) return; // refetch whenever we come back to the list
    playoffsApi.overview().then(r => setRows(r.leagues)).catch(e => toast.error(getErrorMessage(e)));
  }, [leagueId]);

  return (
    <AdminSection icon={Trophy} title="Playoffs">
      {leagueId ? (
        <PlayoffEditor leagueId={leagueId} onBack={() => setParams({})} />
      ) : !rows ? (
        <div className="text-xs text-text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-text-muted">No active leagues.</div>
      ) : (
        <ul className="space-y-1">
          {rows.map(r => {
            const b = stateBadge(r);
            return (
              <li key={r.leagueId}>
                <button onClick={() => setParams({ league: r.leagueId })}
                  className="w-full flex items-center gap-3 rounded-md border border-border-subtle bg-surface-raised/40 hover:bg-surface-overlay/40 px-3 py-2 text-left">
                  <span className="text-sm text-text-primary truncate min-w-0 flex-1">{r.leagueName}</span>
                  <span className="hidden sm:inline text-[10px] font-mono text-text-muted">{r.phase} - top {r.topN}</span>
                  <Badge variant="outline" className={cn('font-mono text-[10px] shrink-0', b.cls)}>{b.text}</Badge>
                  <ChevronRight size={14} className="text-text-muted shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </AdminSection>
  );
}
