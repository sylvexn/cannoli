import type { Player, Trade } from '@/lib/types';
import { useLeagueData } from '@/lib/league-data-context';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ArrowLeftRight, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';

const statusConfig: Record<Trade['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-draw border-draw/30 bg-draw/10' },
  accepted: { label: 'Accepted', className: 'text-win border-win/30 bg-win/10' },
  rejected: { label: 'Rejected', className: 'text-loss border-loss/30 bg-loss/10' },
  expired: { label: 'Expired', className: 'text-text-muted border-border-subtle bg-surface-overlay/50' },
};

/** Compact horizontal trade card for proposals */
export function CompactTradeCard({ trade, leagueUrl }: { trade: Trade; leagueUrl: (path: string) => string }) {
  const { players } = useLeagueData();
  const playerMap = new Map<string, Player>(players.map(p => [p.id, p]));
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
