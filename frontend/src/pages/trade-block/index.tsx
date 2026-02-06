import { useState, useMemo, useEffect } from 'react';
import { players } from '@/mocks/players';
import { trades, tradeBlockListings, TRADE_DEADLINE_WEEK } from '@/mocks/trades';
import { currentSeason } from '@/mocks/season';
import type { Player, Trade } from '@/lib/types';
import { useLeagueUrl } from '@/lib/use-league-url';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { AbilityChip } from '@/components/ability-chip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, ArrowLeftRight, Clock, UserPlus,
  Send, Handshake, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { PokemonType } from '@/lib/pokemon';

const playerMap = new Map<string, Player>(players.map(p => [p.id, p]));

const statusConfig: Record<Trade['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-draw border-draw/30 bg-draw/10' },
  accepted: { label: 'Accepted', className: 'text-win border-win/30 bg-win/10' },
  rejected: { label: 'Rejected', className: 'text-loss border-loss/30 bg-loss/10' },
  expired: { label: 'Expired', className: 'text-text-muted border-border-subtle bg-surface-overlay/50' },
};

export function TradeBlockPage() {
  const leagueUrl = useLeagueUrl();
  const deadlinePassed = currentSeason.currentWeek > TRADE_DEADLINE_WEEK;
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [proposeOpen, setProposeOpen] = useState<string | null>(null); // listing key

  const activeTrades = useMemo(
    () => trades.filter(t => t.status === 'pending' || t.status === 'expired').sort((a, b) => b.week - a.week),
    [],
  );
  const completedTrades = useMemo(() => {
    let list = trades.filter(t => t.status === 'accepted' || t.status === 'rejected');
    if (teamFilter) list = list.filter(t => t.proposer === teamFilter || t.recipient === teamFilter);
    return list.sort((a, b) => b.week - a.week);
  }, [teamFilter]);

  // Group completed trades by week
  const tradesByWeek = useMemo(() => {
    const groups = new Map<number, Trade[]>();
    for (const t of completedTrades) {
      const existing = groups.get(t.week) ?? [];
      existing.push(t);
      groups.set(t.week, existing);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [completedTrades]);

  // Teams involved in any trade (for filter)
  const involvedTeams = useMemo(() => {
    const ids = new Set<string>();
    for (const t of trades) {
      ids.add(t.proposer);
      if (t.recipient !== 'pool') ids.add(t.recipient);
    }
    return [...ids].map(id => playerMap.get(id)).filter(Boolean) as Player[];
  }, []);

  useEffect(() => {
    const allNames = [
      ...trades.flatMap(t => [...t.offering, ...t.requesting]),
      ...tradeBlockListings.map(l => l.pokemonName),
    ];
    preloadSprites(allNames);
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Trade Block</h1>
          <p className="text-sm text-text-muted">Season {currentSeason.seasonNumber} trades & free agency</p>
        </div>
        {/* Deadline badge — compact */}
        {deadlinePassed ? (
          <Badge variant="outline" className="text-loss border-loss/30 bg-loss/10 gap-1.5 px-3 py-1">
            <AlertTriangle size={12} />
            Deadline passed (Week {TRADE_DEADLINE_WEEK})
          </Badge>
        ) : (
          <Badge variant="outline" className="text-neon border-neon/30 bg-neon/10 gap-1.5 px-3 py-1">
            <Clock size={12} />
            Deadline: Week {TRADE_DEADLINE_WEEK} · {TRADE_DEADLINE_WEEK - currentSeason.currentWeek}w left
          </Badge>
        )}
      </div>

      {/* 3-column layout: Block | Proposals | History */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(300px,1fr)_minmax(280px,0.8fr)] gap-4">

        {/* ═══ ON THE BLOCK ═══ */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold text-text-primary flex items-center gap-2 uppercase tracking-wider">
              <Handshake size={14} className="text-neon" />
              On the Block
              <Badge variant="outline" className="text-[10px] border-border-subtle text-text-muted ml-auto">
                {tradeBlockListings.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border-subtle/30">
              {tradeBlockListings.map(listing => {
                const team = playerMap.get(listing.teamId);
                const mon = team?.roster.find(m => m.name === listing.pokemonName);
                if (!team || !mon) return null;
                const kd = mon.seasonStats.gp > 0
                  ? `${mon.seasonStats.kills}/${mon.seasonStats.deaths} in ${mon.seasonStats.gp}G`
                  : null;

                return (
                  <div
                    key={`${listing.teamId}-${listing.pokemonName}`}
                    className={cn(
                      'px-3 py-2.5 transition-colors group',
                      deadlinePassed ? 'opacity-40' : 'hover:bg-surface-overlay/30',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <PokemonSprite name={mon.name} size="md" className="shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-mono font-medium text-text-primary">{mon.name}</span>
                          <TierBadge points={mon.tier} />
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <TypeChip types={mon.types as PokemonType[]} size="xs" />
                          {kd && (
                            <span className="text-[10px] text-text-muted font-mono">
                              <span className="text-win">{mon.seasonStats.kills}</span>
                              <span className="text-text-muted">/</span>
                              <span className="text-loss">{mon.seasonStats.deaths}</span>
                              <span className="text-text-muted ml-0.5">({mon.seasonStats.gp}G)</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          {mon.abilities.slice(0, 2).map(a => (
                            <AbilityChip key={a} name={a} />
                          ))}
                        </div>
                        {listing.note && (
                          <p className="text-[10px] text-text-muted mt-1 italic leading-tight">"{listing.note}"</p>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-center gap-1">
                        <Link to={leagueUrl(`/teams/${team.id}`)} className="group/team">
                          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                        </Link>
                        <span className="text-[8px] text-text-muted">{team.teamAbbrev}</span>
                        {!deadlinePassed && (
                          <Button
                            size="xs"
                            variant="outline"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-neon border-neon/30 hover:bg-neon/10 mt-0.5"
                            onClick={() => setProposeOpen(`${listing.teamId}-${listing.pokemonName}`)}
                          >
                            <Send size={10} />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ═══ PROPOSALS ═══ */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold text-text-primary flex items-center gap-2 uppercase tracking-wider">
              <ArrowLeftRight size={14} className="text-draw" />
              Proposals
              {activeTrades.filter(t => t.status === 'pending').length > 0 && (
                <Badge variant="outline" className="text-[10px] text-draw border-draw/30 bg-draw/10">
                  {activeTrades.filter(t => t.status === 'pending').length} pending
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] border-border-subtle text-text-muted ml-auto">
                {activeTrades.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-3 pb-3">
            {activeTrades.length > 0 ? (
              activeTrades.map(trade => (
                <CompactTradeCard key={trade.id} trade={trade} leagueUrl={leagueUrl} />
              ))
            ) : (
              <p className="text-sm text-text-muted text-center py-6">No active proposals</p>
            )}
          </CardContent>
        </Card>

        {/* ═══ TRANSACTION HISTORY ═══ */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold text-text-primary flex items-center gap-2 uppercase tracking-wider">
              <Clock size={14} className="text-text-muted" />
              History
              <Badge variant="outline" className="text-[10px] border-border-subtle text-text-muted ml-auto">
                {completedTrades.length}
              </Badge>
            </CardTitle>
            {/* Team filter */}
            {involvedTeams.length > 0 && (
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <button
                  onClick={() => setTeamFilter(null)}
                  className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors',
                    !teamFilter ? 'bg-neon/15 text-neon' : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  All
                </button>
                {involvedTeams.map(team => (
                  <button
                    key={team.id}
                    onClick={() => setTeamFilter(teamFilter === team.id ? null : team.id)}
                    className={cn(
                      'transition-all',
                      teamFilter === team.id ? 'opacity-100 ring-1 ring-neon/40 rounded-full' : 'opacity-50 hover:opacity-80',
                    )}
                  >
                    <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                  </button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {tradesByWeek.length > 0 ? (
              tradesByWeek.map(([week, weekTrades]) => (
                <div key={week}>
                  <div className="px-3 py-1 bg-surface-overlay/30 text-[10px] font-mono font-bold text-text-muted uppercase tracking-widest">
                    Week {week}
                  </div>
                  <div className="divide-y divide-border-subtle/20">
                    {weekTrades.map(trade => {
                      const proposer = playerMap.get(trade.proposer);
                      const isFreeAgent = trade.recipient === 'pool';
                      const recipient = isFreeAgent ? null : playerMap.get(trade.recipient);

                      return (
                        <div key={trade.id} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-overlay/20 transition-colors">
                          {trade.status === 'accepted' ? (
                            isFreeAgent ? (
                              <UserPlus size={11} className="text-neon shrink-0" />
                            ) : (
                              <ArrowLeftRight size={11} className="text-win shrink-0" />
                            )
                          ) : (
                            <X size={11} className="text-loss shrink-0" />
                          )}

                          <div className="flex items-center gap-1 shrink-0">
                            {proposer && <TeamLogo abbrev={proposer.teamAbbrev} color={proposer.teamColor} size="sm" />}
                            {!isFreeAgent && recipient && (
                              <>
                                <span className="text-text-muted text-[8px]">↔</span>
                                <TeamLogo abbrev={recipient.teamAbbrev} color={recipient.teamColor} size="sm" />
                              </>
                            )}
                          </div>

                          <div className="flex-1 min-w-0 text-[11px] text-text-secondary truncate">
                            <span className="text-text-primary font-medium">{trade.offering.join(', ')}</span>
                            <span className="text-text-muted mx-1">for</span>
                            <span className="text-text-primary font-medium">{trade.requesting.join(', ')}</span>
                          </div>

                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[8px] px-1 py-0 shrink-0',
                              trade.status === 'accepted' ? 'text-win border-win/30' : 'text-loss border-loss/30',
                            )}
                          >
                            {trade.status === 'accepted' ? (isFreeAgent ? 'FA' : 'Trade') : 'Rej'}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted text-center py-6">No transactions{teamFilter ? ' for this team' : ''}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Propose Trade Dialog */}
      <Dialog open={!!proposeOpen} onOpenChange={open => { if (!open) setProposeOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propose Trade</DialogTitle>
            <DialogDescription>
              Send a trade proposal to this team's manager. It will need admin approval.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center text-sm text-text-muted">
            Trade proposal form coming soon — backend required.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProposeOpen(null)}>Cancel</Button>
            <Button
              className="bg-neon text-surface-base hover:bg-neon/90"
              onClick={() => { setProposeOpen(null); toast.success('Feature coming soon'); }}
            >
              Send Proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Compact horizontal trade card for proposals */
function CompactTradeCard({ trade, leagueUrl }: { trade: Trade; leagueUrl: (path: string) => string }) {
  const proposer = playerMap.get(trade.proposer);
  const isFreeAgent = trade.recipient === 'pool';
  const recipient = isFreeAgent ? null : playerMap.get(trade.recipient);
  const status = statusConfig[trade.status];

  function findTier(pokemonName: string, teamId: string): number {
    return playerMap.get(teamId)?.roster.find(m => m.name === pokemonName)?.tier ?? 0;
  }

  return (
    <div className={cn(
      'rounded-lg border bg-surface-raised/50 overflow-hidden',
      trade.status === 'pending' ? 'border-draw/20' : 'border-border-default',
    )}>
      {/* Header strip */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-overlay/20 border-b border-border-subtle/30">
        <span className="text-[10px] font-mono text-text-muted">W{trade.week}</span>
        <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0', status.className)}>
          {status.label}
        </Badge>
        {isFreeAgent && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-neon border-neon/30 bg-neon/10">
            FA
          </Badge>
        )}
        <span className="text-[9px] text-text-muted ml-auto">
          {new Date(trade.proposedAt).toLocaleDateString()}
        </span>
      </div>

      {/* Trade body */}
      <div className="px-3 py-2 flex items-center gap-2">
        {/* Proposer */}
        <div className="flex-1 min-w-0">
          {proposer && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <TeamLogo abbrev={proposer.teamAbbrev} color={proposer.teamColor} size="sm" />
              <Link to={leagueUrl(`/teams/${proposer.id}`)} className="text-[11px] font-medium text-text-primary hover:text-neon transition-colors truncate">
                {proposer.teamName}
              </Link>
            </div>
          )}
          <div className="space-y-0.5">
            {trade.offering.map(name => (
              <div key={name} className="flex items-center gap-1.5">
                <PokemonSprite name={name} size="xs" />
                <span className="text-xs font-mono text-text-primary truncate">{name}</span>
                {findTier(name, trade.proposer) > 0 && <TierBadge points={findTier(name, trade.proposer)} />}
              </div>
            ))}
          </div>
        </div>

        {/* Arrow */}
        <div className="shrink-0 flex flex-col items-center text-text-muted">
          <ArrowLeftRight size={14} />
        </div>

        {/* Recipient */}
        <div className="flex-1 min-w-0">
          {isFreeAgent ? (
            <div className="flex items-center gap-1.5 mb-1.5">
              <UserPlus size={12} className="text-neon" />
              <span className="text-[11px] font-medium text-neon">Free Agent Pool</span>
            </div>
          ) : recipient ? (
            <div className="flex items-center gap-1.5 mb-1.5">
              <TeamLogo abbrev={recipient.teamAbbrev} color={recipient.teamColor} size="sm" />
              <Link to={leagueUrl(`/teams/${recipient.id}`)} className="text-[11px] font-medium text-text-primary hover:text-neon transition-colors truncate">
                {recipient.teamName}
              </Link>
            </div>
          ) : null}
          <div className="space-y-0.5">
            {trade.requesting.map(name => (
              <div key={name} className="flex items-center gap-1.5">
                <PokemonSprite name={name} size="xs" />
                <span className="text-xs font-mono text-text-primary truncate">{name}</span>
                {!isFreeAgent && findTier(name, trade.recipient) > 0 && (
                  <TierBadge points={findTier(name, trade.recipient)} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
