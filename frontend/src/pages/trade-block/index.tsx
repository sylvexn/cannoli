import { useMemo, useEffect } from 'react';
import { players } from '@/mocks/players';
import { trades, tradeBlockListings, TRADE_DEADLINE_WEEK } from '@/mocks/trades';
import { currentSeason } from '@/mocks/season';
import type { Player } from '@/lib/types';
import { useLeagueUrl } from '@/lib/use-league-url';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowLeftRight, Clock, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TradeCard } from './trade-card';

const playerMap = new Map<string, Player>(players.map(p => [p.id, p]));

export function TradeBlockPage() {
  const leagueUrl = useLeagueUrl();
  const deadlinePassed = currentSeason.currentWeek > TRADE_DEADLINE_WEEK;

  const activeTrades = useMemo(
    () => trades.filter(t => t.status === 'pending' || t.status === 'expired').sort((a, b) => b.week - a.week),
    [],
  );
  const completedTrades = useMemo(
    () => trades.filter(t => t.status === 'accepted' || t.status === 'rejected').sort((a, b) => b.week - a.week),
    [],
  );

  useEffect(() => {
    const allNames = [
      ...trades.flatMap(t => [...t.offering, ...t.requesting]),
      ...tradeBlockListings.map(l => l.pokemonName),
    ];
    preloadSprites(allNames);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-text-primary">Trade Block</h1>
        <p className="text-sm text-text-muted">Season {currentSeason.seasonNumber} trades & free agency</p>
      </div>

      {/* Deadline banner */}
      {deadlinePassed ? (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-loss/10 border border-loss/20">
          <AlertTriangle size={14} className="text-loss shrink-0" />
          <span className="text-xs text-loss font-medium">
            Trade deadline has passed (Week {TRADE_DEADLINE_WEEK})
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-neon/10 border border-neon/20">
          <Clock size={14} className="text-neon shrink-0" />
          <span className="text-xs text-neon font-medium">
            Trade deadline: Week {TRADE_DEADLINE_WEEK} · {TRADE_DEADLINE_WEEK - currentSeason.currentWeek} week{TRADE_DEADLINE_WEEK - currentSeason.currentWeek !== 1 ? 's' : ''} remaining
          </span>
        </div>
      )}

      {/* On the Block — listings */}
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-text-primary flex items-center gap-2">
            On the Block
            <Badge variant="outline" className="text-[10px] border-border-subtle text-text-muted">
              {tradeBlockListings.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tradeBlockListings.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tradeBlockListings.map(listing => {
                const team = playerMap.get(listing.teamId);
                const mon = team?.roster.find(m => m.name === listing.pokemonName);
                if (!team || !mon) return null;

                return (
                  <div
                    key={`${listing.teamId}-${listing.pokemonName}`}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-lg border transition-colors',
                      deadlinePassed
                        ? 'border-border-subtle/30 opacity-50'
                        : 'border-border-subtle hover:border-border-default hover:bg-surface-overlay/30',
                    )}
                  >
                    <PokemonSprite name={mon.name} size="sm" className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-text-primary truncate">{mon.name}</span>
                        <TierBadge points={mon.tier} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <TypeChip types={mon.types} size="xs" />
                      </div>
                      {listing.note && (
                        <p className="text-[10px] text-text-muted mt-1 italic truncate">"{listing.note}"</p>
                      )}
                    </div>
                    <Link
                      to={leagueUrl(`/teams/${team.id}`)}
                      className="shrink-0 group/team flex items-center gap-1"
                    >
                      <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                      <span className="text-[10px] text-text-muted group-hover/team:text-neon transition-colors">
                        {team.teamAbbrev}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-text-muted text-center py-4">No Pokemon currently on the block</p>
          )}
        </CardContent>
      </Card>

      {/* Active / Pending proposals */}
      {activeTrades.length > 0 && (
        <div>
          <h2 className="text-sm font-heading font-semibold text-text-primary mb-3 flex items-center gap-2">
            <ArrowLeftRight size={14} />
            Proposals
            <Badge variant="outline" className="text-[10px] border-border-subtle text-text-muted">
              {activeTrades.length}
            </Badge>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeTrades.map(trade => (
              <TradeCard key={trade.id} trade={trade} playerMap={playerMap} />
            ))}
          </div>
        </div>
      )}

      {/* Trade history */}
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-text-primary flex items-center gap-2">
            Transaction History
            <Badge variant="outline" className="text-[10px] border-border-subtle text-text-muted">
              {completedTrades.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border-subtle/30">
            {completedTrades.map(trade => {
              const proposer = playerMap.get(trade.proposer);
              const isFreeAgent = trade.recipient === 'pool';
              const recipient = isFreeAgent ? null : playerMap.get(trade.recipient);

              return (
                <div key={trade.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/30 transition-colors">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border-subtle shrink-0">
                    W{trade.week}
                  </Badge>

                  {trade.status === 'accepted' ? (
                    isFreeAgent ? (
                      <UserPlus size={12} className="text-neon shrink-0" />
                    ) : (
                      <ArrowLeftRight size={12} className="text-win shrink-0" />
                    )
                  ) : (
                    <ArrowLeftRight size={12} className="text-loss shrink-0" />
                  )}

                  {/* Teams involved */}
                  <div className="flex items-center gap-1 shrink-0">
                    {proposer && <TeamLogo abbrev={proposer.teamAbbrev} color={proposer.teamColor} size="sm" />}
                    {!isFreeAgent && recipient && (
                      <>
                        <span className="text-text-muted text-[10px]">↔</span>
                        <TeamLogo abbrev={recipient.teamAbbrev} color={recipient.teamColor} size="sm" />
                      </>
                    )}
                  </div>

                  {/* Pokemon exchanged */}
                  <div className="flex-1 min-w-0 text-xs text-text-secondary truncate">
                    {trade.offering.join(', ')}
                    <span className="text-text-muted mx-1">for</span>
                    {trade.requesting.join(', ')}
                  </div>

                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] px-1.5 py-0 shrink-0',
                      trade.status === 'accepted' ? 'text-win border-win/30' : 'text-loss border-loss/30',
                    )}
                  >
                    {trade.status === 'accepted' ? (isFreeAgent ? 'FA' : 'Trade') : 'Rejected'}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
