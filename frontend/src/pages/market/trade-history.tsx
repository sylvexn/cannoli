/**
 * Trade Activity — HISTORY section. Split out of trade-activity.tsx to keep
 * both files under the LOC ceiling. Renders resolved (accepted / rejected)
 * trades grouped by week (desc), behind a Collapsible, with a team-filter
 * pill row. FA pickups (recipient === 'pool') render with the pool glyph.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ArrowLeftRight, ChevronDown, History, UserPlus, X } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useLeague } from '@/lib/league-context';
import type { Player, Trade } from '@/lib/types';

export interface TradeHistoryProps {
  /** Only resolved trades — accepted / rejected. Caller pre-filters. */
  trades: Trade[];
  /** id → Player lookup for resolving the two sides. */
  playerMap: Map<string, Player>;
}

/** A resolved trade is "FA" when it landed in / came from the free-agent pool. */
function isFreeAgentTrade(t: Trade): boolean {
  return t.recipient === 'pool';
}

export function TradeHistory({ trades, playerMap }: TradeHistoryProps) {
  const league = useLeague();
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  // Default OPEN when the history is short; collapse longer lists so the
  // action-relevant sections above stay the focus.
  const [open, setOpen] = useState(trades.length <= 3);

  // Teams that appear on either side of any resolved trade — drives the filter.
  const involvedTeams = useMemo(() => {
    const ids = new Set<string>();
    for (const t of trades) {
      ids.add(t.proposer);
      if (t.recipient !== 'pool') ids.add(t.recipient);
    }
    return [...ids]
      .map(id => playerMap.get(id))
      .filter((p): p is Player => Boolean(p));
  }, [trades, playerMap]);

  const filtered = useMemo(() => {
    if (!teamFilter) return trades;
    return trades.filter(t => t.proposer === teamFilter || t.recipient === teamFilter);
  }, [trades, teamFilter]);

  // Group by week, newest first.
  const byWeek = useMemo(() => {
    const groups = new Map<number, Trade[]>();
    for (const t of filtered) {
      const list = groups.get(t.week) ?? [];
      list.push(t);
      groups.set(t.week, list);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  if (trades.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border-default bg-surface-raised/40">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left group/hist">
        <History size={14} className="text-text-muted shrink-0" />
        <span className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary">
          History
        </span>
        <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-border-subtle text-text-muted">
          {trades.length}
        </Badge>
        <ChevronDown
          size={15}
          className={cn(
            'ml-auto text-text-muted transition-transform shrink-0',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        {/* Team filter pills */}
        {involvedTeams.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 border-b border-border-subtle">
            <button
              type="button"
              onClick={() => setTeamFilter(null)}
              className={cn(
                'text-[11px] px-2 py-0.5 rounded font-medium transition-colors',
                !teamFilter
                  ? 'bg-neon/15 text-neon'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              All
            </button>
            {involvedTeams.map(team => (
              <button
                key={team.id}
                type="button"
                title={team.teamName}
                onClick={() => setTeamFilter(teamFilter === team.id ? null : team.id)}
                className={cn(
                  'rounded-full transition-all',
                  teamFilter === team.id
                    ? 'opacity-100 ring-1 ring-neon/40'
                    : 'opacity-50 hover:opacity-90',
                )}
              >
                <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
              </button>
            ))}
          </div>
        )}

        {byWeek.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-muted">
            No transactions for this team.
          </div>
        ) : (
          byWeek.map(([week, weekTrades]) => (
            <div key={week}>
              <div className="px-3 py-1 bg-surface-overlay/30 text-[11px] font-mono font-bold text-text-muted uppercase tracking-widest">
                Week {week}
              </div>
              <div className="divide-y divide-border-subtle">
                {weekTrades.map(t => (
                  <HistoryRow key={t.id} trade={t} playerMap={playerMap} leagueId={league.id} />
                ))}
              </div>
            </div>
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function HistoryRow({
  trade,
  playerMap,
  leagueId,
}: {
  trade: Trade;
  playerMap: Map<string, Player>;
  leagueId: string;
}) {
  const fa = isFreeAgentTrade(trade);
  const accepted = trade.status === 'accepted';
  // Approved for a future week: agreed, but rosters don't change until then.
  const scheduled = accepted && !trade.appliedAt && trade.effectiveWeek != null;
  const proposer = playerMap.get(trade.proposer) ?? null;
  const recipient = fa ? null : playerMap.get(trade.recipient) ?? null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-overlay/50 transition-colors">
      {/* Status glyph */}
      <span
        className="shrink-0 inline-flex"
        title={
          scheduled ? `Takes effect Week ${trade.effectiveWeek} — rosters unchanged until then`
            : accepted ? (fa ? 'Free agent pickup' : 'Trade accepted')
            : 'Rejected'
        }
      >
        {accepted ? (
          fa ? (
            <UserPlus size={12} className="text-neon" />
          ) : (
            <ArrowLeftRight size={12} className="text-win" />
          )
        ) : (
          <X size={12} className="text-loss" />
        )}
      </span>

      {/* Two sides */}
      <div className="flex items-center gap-1 shrink-0">
        {proposer && <TeamLogoLink team={proposer} leagueId={leagueId} />}
        <span className="text-text-muted text-[11px]">{fa ? '→' : '↔'}</span>
        {fa ? (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-neon/40 bg-neon/5 text-neon"
            title="Free Agent Pool"
          >
            <UserPlus size={10} />
          </span>
        ) : (
          recipient && <TeamLogoLink team={recipient} leagueId={leagueId} />
        )}
      </div>

      {/* Mon names — only join the two sides with "for" when both exist, so a
          pure FA pickup / drop reads as just the mon, not "— for Y". */}
      <div className="flex-1 min-w-0 text-[11px] text-text-secondary truncate">
        {trade.offering.length === 0 && trade.requesting.length === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          <>
            {trade.offering.length > 0 && (
              <span className="text-text-primary font-medium font-mono">{trade.offering.join(', ')}</span>
            )}
            {trade.offering.length > 0 && trade.requesting.length > 0 && (
              <span className="text-text-muted mx-1">for</span>
            )}
            {trade.requesting.length > 0 && (
              <span className="text-text-primary font-medium font-mono">{trade.requesting.join(', ')}</span>
            )}
          </>
        )}
      </div>

      {/* Tiny status badge */}
      <Badge
        variant="outline"
        className={cn(
          'text-[11px] px-1.5 py-0 shrink-0',
          scheduled ? 'text-draw border-draw/30 bg-draw/10'
            : accepted ? 'text-win border-win/30 bg-win/10'
            : 'text-loss border-loss/30 bg-loss/10',
        )}
      >
        {scheduled ? `W${trade.effectiveWeek}` : accepted ? (fa ? 'FA' : 'Trade') : 'Rej'}
      </Badge>
    </div>
  );
}

function TeamLogoLink({ team, leagueId }: { team: Player; leagueId: string }) {
  return (
    <Link
      to={`/league/${leagueId}/teams/${team.id}`}
      title={team.teamName}
      className="transition-opacity hover:opacity-80"
    >
      <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
    </Link>
  );
}
