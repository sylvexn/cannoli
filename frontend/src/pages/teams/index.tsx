import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { standings, players } from '@/mocks/players';
import { getTeamTrades } from '@/mocks/trades';
import { rosterPointsUsed, teraCaptainCount } from '@/lib/roster';
import type { Player, Trade } from '@/lib/types';
import { useLeagueUrl } from '@/lib/use-league-url';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite, preloadSprites } from '@/components/pokemon-sprite';
import { RecordDisplay } from '@/components/record-display';
import { KDDisplay } from '@/components/kd-display';
import { PointCapBar } from '@/components/point-cap-bar';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChevronDown, ArrowLeftRight, UserPlus } from 'lucide-react';

export function TeamsPage() {
  const leagueUrl = useLeagueUrl();

  useEffect(() => {
    preloadSprites(players.flatMap(p => p.roster.map(m => m.name)));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-text-primary">Teams</h1>
        <p className="text-sm text-text-muted">{players.length} teams · Season 10</p>
      </div>

      <div className="columns-1 md:columns-2 xl:columns-3 gap-4 [&>*]:mb-4">
        {standings.map((player, rank) => (
          <TeamCard key={player.id} player={player} rank={rank + 1} leagueUrl={leagueUrl} />
        ))}
      </div>
    </div>
  );
}

function TeamCard({
  player,
  rank,
  leagueUrl,
}: {
  player: Player;
  rank: number;
  leagueUrl: (path: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const points = useMemo(() => rosterPointsUsed(player.roster), [player.roster]);
  const captains = useMemo(() => teraCaptainCount(player.roster), [player.roster]);
  const teamTrades = useMemo(() => getTeamTrades(player.id), [player.id]);
  const completedTrades = teamTrades.filter(t => t.status === 'accepted');

  const totalKills = player.roster.reduce((s, m) => s + m.seasonStats.kills, 0);
  const totalDeaths = player.roster.reduce((s, m) => s + m.seasonStats.deaths, 0);

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden group break-inside-avoid">
      {/* Team color accent */}
      <div className="h-1" style={{ backgroundColor: player.teamColor }} />

      {/* Main card content — clickable to team profile */}
      <Link
        to={leagueUrl(`/teams/${player.id}`)}
        className="block px-4 pt-3 pb-2 hover:bg-surface-overlay/30 transition-colors"
      >
        {/* Header row */}
        <div className="flex items-start gap-3">
          <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary truncate">
                {player.teamName}
              </span>
              {rank <= 3 && (
                <span className={`rank-badge rank-badge-${rank} w-4 h-4 text-[8px]`}>
                  {rank}
                </span>
              )}
            </div>
            <span className="text-[10px] text-text-muted/60">{player.name}</span>
          </div>
          <RecordDisplay
            wins={player.record.wins}
            losses={player.record.losses}
            differential={player.record.differential}
            className="text-xs"
          />
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-2 text-[10px] text-text-muted">
          <KDDisplay kills={totalKills} deaths={totalDeaths} className="text-[10px]" />
          <span className="tabular-nums">{captains} captains</span>
          {completedTrades.length > 0 && (
            <span className="flex items-center gap-0.5">
              <ArrowLeftRight size={10} />
              {completedTrades.length} trade{completedTrades.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Point cap */}
        <div className="mt-2">
          <PointCapBar used={points} />
        </div>

        {/* Sprite row */}
        <div className="flex items-center gap-0.5 mt-2">
          {player.roster.map(mon => (
            <div key={mon.name} className="relative">
              <PokemonSprite name={mon.name} size="xs" />
              {mon.isTeraCaptain && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-pink" />
              )}
            </div>
          ))}
        </div>
      </Link>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-center py-1.5 border-t border-border-subtle/30 hover:bg-surface-overlay/30 transition-colors"
      >
        <ChevronDown
          size={14}
          className={cn(
            'text-text-muted transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {/* Expanded roster detail */}
      <div className={cn(
        'grid transition-all duration-200 ease-out',
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="px-4 pb-3 space-y-3">
            {/* Roster table */}
            <div className="divide-y divide-border-subtle/30">
              {player.roster.map(mon => (
                <div key={mon.name} className="flex items-center gap-2 py-1.5">
                  <PokemonSprite name={mon.name} size="xs" className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className={cn(
                      'text-xs font-medium truncate block',
                      mon.isTeraCaptain ? 'text-pink' : 'text-text-primary',
                    )}>
                      {mon.name}
                      {mon.isTeraCaptain && <span className="text-[9px] text-text-muted ml-1">(T)</span>}
                    </span>
                  </div>
                  <TypeChip types={mon.types} size="xs" />
                  <TierBadge points={mon.tier} />
                  <span className="tabular-nums text-[10px] shrink-0 w-12 text-right">
                    <span className="text-win">{mon.seasonStats.kills}</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-loss">{mon.seasonStats.deaths}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Trade history */}
            {completedTrades.length > 0 && (
              <div>
                <h4 className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Transactions</h4>
                <div className="space-y-1">
                  {completedTrades.map(trade => (
                    <TradeRow key={trade.id} trade={trade} teamId={player.id} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function TradeRow({ trade, teamId }: { trade: Trade; teamId: string }) {
  const isFreeAgent = trade.recipient === 'pool';
  const isProposer = trade.proposer === teamId;
  const sent = isProposer ? trade.offering : trade.requesting;
  const received = isProposer ? trade.requesting : trade.offering;

  return (
    <div className="flex items-center gap-2 text-[10px] text-text-secondary py-0.5">
      <Badge variant="outline" className="text-[9px] px-1 py-0 border-border-subtle shrink-0">
        W{trade.week}
      </Badge>
      {isFreeAgent ? (
        <UserPlus size={10} className="text-neon shrink-0" />
      ) : (
        <ArrowLeftRight size={10} className="text-text-muted shrink-0" />
      )}
      <span className="truncate">
        <span className="text-win">+{received.join(', ')}</span>
        <span className="text-text-muted mx-1">/</span>
        <span className="text-loss">-{sent.join(', ')}</span>
      </span>
    </div>
  );
}
