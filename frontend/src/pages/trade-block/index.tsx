import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { EmptyState } from '@/components/empty-state';
import type { Player, Trade } from '@/lib/types';
import type { ApiTradeBlockListing, ApiTrade } from '@/lib/api';
import { api } from '@/lib/api';
import { useLeagueUrl } from '@/lib/use-league-url';
import { TeamLogo } from '@/components/team-logo';
import { TeamLink } from '@/components/team-link';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { AbilityChip } from '@/components/ability-chip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, ArrowLeftRight, Clock, UserPlus,
  Send, Handshake, X, Wand2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PokemonType } from '@/lib/pokemon';
import { CompactTradeCard } from './compact-trade-card';
import { TradeProposeDialog } from './trade-propose-dialog';
import { TradeWizard } from './wizard/trade-wizard';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { pokemonRoute } from '@/lib/pokemon-route';
import { TradeBlockSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export function TradeBlockPage() {
  const leagueUrl = useLeagueUrl();
  const { players, transactions, loading } = useLeagueData();
  const league = useLeague();
  const currentSeason = league.season;
  const playerMap = useMemo(() => new Map<string, Player>(players.map(p => [p.id, p])), [players]);
  const tradeDeadlineWeek = currentSeason.tradeDeadlineWeek ?? 7;
  const deadlinePassed = currentSeason.currentWeek > tradeDeadlineWeek;

  // Fetch trade block listings from API
  const [tradeBlockListings, setTradeBlockListings] = useState<ApiTradeBlockListing[]>([]);
  useEffect(() => {
    api.getTradeBlock(league.id).then(setTradeBlockListings).catch(() => {});
  }, [league.id]);

  // Fetch real trade rows (pending / awaiting_admin / rejected — accepted come via transactions)
  const [apiTrades, setApiTrades] = useState<ApiTrade[]>([]);
  const loadTrades = useCallback(() => {
    api.getTrades(league.id).then(setApiTrades).catch(() => {});
  }, [league.id]);
  useEffect(() => { loadTrades(); }, [loadTrades]);

  // Convert API transactions (accepted FA/trade) + live trade rows to Trade format
  const trades: Trade[] = useMemo(() => {
    const fromTransactions: Trade[] = transactions
      .filter(t => t.type === 'fa' || t.type === 'trade')
      .map(t => ({
        id: `t${t.id}`,
        week: t.week,
        status: 'accepted' as const,
        proposer: t.teamId,
        // FA pickups: recipient is 'pool' regardless of otherTeamId
        recipient: t.type === 'fa' ? 'pool' : (t.otherTeamId || 'pool'),
        offering: t.pokemonOut ? [t.pokemonOut] : [],
        requesting: t.pokemonIn ? [t.pokemonIn] : [],
        proposedAt: '',
        resolvedAt: '',
      }));

    // Live trade proposals (anything not already accepted — accepted ones are
    // already represented as transactions above to avoid duplicates)
    const fromApi: Trade[] = apiTrades
      .filter(t => t.status !== 'accepted')
      .map(t => ({
        id: t.id,
        week: t.week,
        status: t.status,
        proposer: t.proposerId,
        recipient: t.recipientId,
        offering: t.offering,
        requesting: t.requesting,
        proposedAt: t.proposedAt || '',
        resolvedAt: t.resolvedAt || '',
      }));

    return [...fromApi, ...fromTransactions];
  }, [transactions, apiTrades]);
  const { openSideCard } = usePokemonSideCard();
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [proposeOpen, setProposeOpen] = useState<{
    teamId: string;
    /** If set, the dialog opens pre-filled as a counter to this trade. */
    counterTo?: Trade;
  } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const activeTrades = useMemo(
    () => trades.filter(t =>
      t.status === 'pending' || t.status === 'awaiting_admin' || t.status === 'expired'
    ).sort((a, b) => b.week - a.week),
    [trades],
  );
  const pendingCount = useMemo(
    () => activeTrades.filter(t => t.status === 'pending' || t.status === 'awaiting_admin').length,
    [activeTrades],
  );
  const completedTrades = useMemo(() => {
    let list = trades.filter(t => t.status === 'accepted' || t.status === 'rejected');
    if (teamFilter) list = list.filter(t => t.proposer === teamFilter || t.recipient === teamFilter);
    return list.sort((a, b) => b.week - a.week);
  }, [trades, teamFilter]);

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
  }, [trades, playerMap]);

  useEffect(() => {
    const allNames = [
      ...trades.flatMap(t => [...t.offering, ...t.requesting]),
      ...tradeBlockListings.map(l => l.pokemonName),
    ];
    preloadSprites(allNames);
  }, [trades]);

  if (loading) return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-40 bg-surface-overlay/50 mb-2" />
          <Skeleton className="h-4 w-48 bg-surface-overlay/50" />
        </div>
        <Skeleton className="h-7 w-44 rounded-full bg-surface-overlay/50" />
      </div>
      <TradeBlockSkeleton />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span className="text-purple-400">Trade</span>{' '}
            <span className="text-text-primary">Block</span>
          </h1>
          <p className="text-sm text-text-muted">Season {currentSeason.seasonNumber} trades & free agency</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Trade Wizard entry — multi-step companion to the inline propose flow */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-purple-400/40 text-purple-300 hover:bg-purple-400/10 hover:text-purple-200"
            onClick={() => setWizardOpen(true)}
          >
            <Wand2 size={12} />
            Trade Wizard
          </Button>
          {/* Deadline badge — compact */}
          {deadlinePassed ? (
          <Badge variant="outline" className="text-loss border-loss/30 bg-loss/10 gap-1.5 px-3 py-1">
            <AlertTriangle size={12} />
            Deadline passed (Week {tradeDeadlineWeek})
          </Badge>
        ) : (
          <Badge variant="outline" className="text-neon border-neon/30 bg-neon/10 gap-1.5 px-3 py-1">
            <Clock size={12} />
            Deadline: Week {tradeDeadlineWeek} · {tradeDeadlineWeek - currentSeason.currentWeek}w left
          </Badge>
        )}
        </div>
      </div>

      {/* 3-column layout: Block | Proposals | History */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(300px,1fr)_minmax(280px,0.8fr)] gap-4">

        {/* === ON THE BLOCK === */}
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
              {tradeBlockListings.map((listing, i) => {
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
                      'stagger-item row-interactive px-3 py-2.5 transition-colors group',
                      deadlinePassed ? 'opacity-40' : 'hover:bg-surface-overlay/30',
                    )}
                    style={{
                      ['--i' as never]: Math.min(i, 20),
                      ['--card-accent' as never]: team.teamColor,
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="shrink-0 mt-0.5 cursor-pointer" onClick={() => openSideCard(mon.name)}>
                        <PokemonSprite name={mon.name} size="md" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link to={pokemonRoute(mon.name)} className="text-sm font-mono font-medium text-text-primary hover:text-neon hover:underline transition-colors">{mon.name}</Link>
                          <TierBadge points={mon.tier} />
                        </div>
                        {mon.nickname ? (
                          <div className="italic text-text-muted text-[11px] truncate leading-tight" title={mon.nickname}>
                            "{mon.nickname}"
                          </div>
                        ) : null}
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
                        <Link to={leagueUrl(`/teams/${team.id}`)} viewTransition className="group/team">
                          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                        </Link>
                        <span className="text-[8px] text-text-muted">{team.teamAbbrev}</span>
                        {!deadlinePassed && (
                          <Button
                            size="xs"
                            variant="outline"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-neon border-neon/30 hover:bg-neon/10 mt-0.5"
                            onClick={() => setProposeOpen({ teamId: listing.teamId })}
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

        {/* === PROPOSALS === */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold text-text-primary flex items-center gap-2 uppercase tracking-wider">
              <ArrowLeftRight size={14} className="text-draw" />
              Proposals
              {pendingCount > 0 && (
                <Badge variant="outline" className="text-[10px] text-draw border-draw/30 bg-draw/10">
                  {pendingCount} pending
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] border-border-subtle text-text-muted ml-auto">
                {activeTrades.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-3 pb-3">
            {activeTrades.length > 0 ? (
              activeTrades.map((trade, i) => (
                <div
                  key={trade.id}
                  className="stagger-item"
                  style={{ ['--i' as never]: Math.min(i, 20) }}
                >
                  <CompactTradeCard
                    trade={trade}
                    onResponded={loadTrades}
                    onCounter={t => setProposeOpen({ teamId: t.proposer, counterTo: t })}
                  />
                </div>
              ))
            ) : (
              <EmptyState
                variant="quiet"
                title="No active proposals."
                subtitle="Nobody's wheelin' and dealin' right now."
                spriteSize="md"
                padding="sm"
              />
            )}
          </CardContent>
        </Card>

        {/* === TRANSACTION HISTORY === */}
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
                            {proposer && (
                              <TeamLink
                                team={{
                                  leagueId: league.id,
                                  teamId: proposer.id,
                                  teamName: proposer.teamName,
                                  teamAbbrev: proposer.teamAbbrev,
                                  teamColor: proposer.teamColor,
                                  record: proposer.record,
                                }}
                                logoOnly
                                logoSize="sm"
                              />
                            )}
                            <span className="text-text-muted text-[8px]">{isFreeAgent ? '→' : '↔'}</span>
                            {isFreeAgent ? (
                              <span
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-neon/40 bg-neon/5 text-neon"
                                title="Free Agent Pool"
                              >
                                <UserPlus size={9} />
                              </span>
                            ) : recipient && (
                              <TeamLink
                                team={{
                                  leagueId: league.id,
                                  teamId: recipient.id,
                                  teamName: recipient.teamName,
                                  teamAbbrev: recipient.teamAbbrev,
                                  teamColor: recipient.teamColor,
                                  record: recipient.record,
                                }}
                                logoOnly
                                logoSize="sm"
                              />
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
              <EmptyState
                variant="nothing-here"
                title={teamFilter ? 'No transactions for this team.' : 'No transactions yet.'}
                spriteSize="md"
                padding="sm"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Propose Trade Dialog (also reused for counter-proposals) */}
      <TradeProposeDialog
        open={!!proposeOpen}
        onClose={() => { setProposeOpen(null); loadTrades(); }}
        recipientTeamId={proposeOpen?.teamId}
        counterTo={proposeOpen?.counterTo}
      />

      {/* Multi-step Trade Wizard — companion to the quick-propose dialog above */}
      <TradeWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); loadTrades(); }}
      />
    </div>
  );
}
