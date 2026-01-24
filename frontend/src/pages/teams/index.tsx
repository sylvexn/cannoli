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
import { Card, CardContent } from '@/components/ui/card';
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

      <Card className="bg-surface-raised border-border-default overflow-hidden">
        <CardContent className="p-0">
          {standings.map((player, rank) => (
            <TeamRow key={player.id} player={player} rank={rank + 1} leagueUrl={leagueUrl} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TeamRow({
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
    <div className="border-b border-border-subtle/50 last:border-b-0">
      {/* Main row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-overlay/40 transition-colors cursor-pointer"
      >
        {/* Rank */}
        <div className="w-6 shrink-0 text-center">
          {rank <= 3 ? (
            <span className={`rank-badge rank-badge-${rank} w-5 h-5 text-[9px]`}>{rank}</span>
          ) : (
            <span className="text-xs font-bold tabular-nums text-text-muted">{rank}</span>
          )}
        </div>

        {/* Team identity */}
        <Link
          to={leagueUrl(`/teams/${player.id}`)}
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-2.5 min-w-0 w-56 shrink-0 group/team"
        >
          <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-text-primary group-hover/team:text-neon transition-colors truncate block">
              {player.teamName}
            </span>
            <span className="text-[10px] text-text-muted/60 block">{player.name}</span>
          </div>
        </Link>

        {/* Record */}
        <div className="shrink-0">
          <RecordDisplay
            wins={player.record.wins}
            losses={player.record.losses}
            differential={player.record.differential}
            className="text-xs"
          />
        </div>

        {/* K/D */}
        <div className="shrink-0 hidden md:block">
          <KDDisplay kills={totalKills} deaths={totalDeaths} className="text-[11px]" />
        </div>

        {/* Point cap (compact) */}
        <div className="hidden lg:block w-36 shrink-0">
          <PointCapBar used={points} />
        </div>

        {/* Sprite strip */}
        <div className="flex-1 min-w-0 hidden xl:flex items-center gap-0.5 justify-end">
          {player.roster.map(mon => (
            <div key={mon.name} className="relative">
              <PokemonSprite name={mon.name} size="xs" />
              {mon.isTeraCaptain && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-pink" />
              )}
            </div>
          ))}
        </div>

        {/* Chevron */}
        <ChevronDown
          size={14}
          className={cn(
            'text-text-muted transition-transform duration-200 shrink-0',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {/* Expanded detail */}
      <div className={cn(
        'grid transition-all duration-200 ease-out',
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1">
            {/* Responsive: sprites on smaller screens + point cap */}
            <div className="flex items-center gap-4 mb-3 lg:hidden">
              <PointCapBar used={points} className="flex-1" />
            </div>
            <div className="flex items-center gap-0.5 mb-3 xl:hidden">
              {player.roster.map(mon => (
                <div key={mon.name} className="relative">
                  <PokemonSprite name={mon.name} size="xs" />
                  {mon.isTeraCaptain && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-pink" />
                  )}
                </div>
              ))}
            </div>

            {/* Roster table */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0">
              {player.roster.map(mon => (
                <div key={mon.name} className="flex items-center gap-2 py-1.5 border-b border-border-subtle/20 last:border-b-0">
                  <PokemonSprite name={mon.name} size="xs" className="shrink-0" />
                  <span className={cn(
                    'text-xs font-medium truncate flex-1',
                    mon.isTeraCaptain ? 'text-pink' : 'text-text-primary',
                  )}>
                    {mon.name}
                    {mon.isTeraCaptain && <span className="text-[9px] text-text-muted ml-1">(T)</span>}
                  </span>
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
              <div className="mt-3 pt-2 border-t border-border-subtle/30">
                <h4 className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Transactions</h4>
                <div className="space-y-1">
                  {completedTrades.map(trade => (
                    <TradeHistoryRow key={trade.id} trade={trade} teamId={player.id} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeHistoryRow({ trade, teamId }: { trade: Trade; teamId: string }) {
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
