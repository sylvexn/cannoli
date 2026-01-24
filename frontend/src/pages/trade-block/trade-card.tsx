import type { Trade, Player } from '@/lib/types';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ArrowRight, UserPlus } from 'lucide-react';

const statusStyles: Record<Trade['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-draw border-draw/30 bg-draw/10' },
  accepted: { label: 'Accepted', className: 'text-win border-win/30 bg-win/10' },
  rejected: { label: 'Rejected', className: 'text-loss border-loss/30 bg-loss/10' },
  expired: { label: 'Expired', className: 'text-text-muted border-border-subtle bg-surface-overlay/50' },
};

interface TradeCardProps {
  trade: Trade;
  playerMap: Map<string, Player>;
}

export function TradeCard({ trade, playerMap }: TradeCardProps) {
  const proposer = playerMap.get(trade.proposer);
  const isFreeAgent = trade.recipient === 'pool';
  const recipient = isFreeAgent ? null : playerMap.get(trade.recipient);
  const status = statusStyles[trade.status];

  // Look up tiers from rosters
  function findTier(pokemonName: string, teamId: string): number {
    const player = playerMap.get(teamId);
    return player?.roster.find(m => m.name === pokemonName)?.tier ?? 0;
  }

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      <div className="px-4 py-3">
        {/* Header: week + status */}
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border-subtle">
            Week {trade.week}
          </Badge>
          <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', status.className)}>
            {status.label}
          </Badge>
          {isFreeAgent && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-neon border-neon/30 bg-neon/10">
              Free Agent
            </Badge>
          )}
        </div>

        {/* Trade visualization */}
        <div className="flex items-center gap-3">
          {/* Proposer side */}
          <div className="flex-1 min-w-0">
            {proposer && (
              <div className="flex items-center gap-1.5 mb-2">
                <TeamLogo abbrev={proposer.teamAbbrev} color={proposer.teamColor} size="sm" />
                <span className="text-xs font-medium text-text-primary truncate">{proposer.teamAbbrev}</span>
                <span className="text-[10px] text-text-muted">sends</span>
              </div>
            )}
            <div className="space-y-1">
              {trade.offering.map(name => (
                <PokemonRow key={name} name={name} tier={findTier(name, trade.proposer)} />
              ))}
            </div>
          </div>

          {/* Exchange arrow */}
          <div className="shrink-0 flex flex-col items-center gap-1">
            <ArrowRight size={16} className="text-text-muted" />
            <ArrowRight size={16} className="text-text-muted rotate-180" />
          </div>

          {/* Recipient side */}
          <div className="flex-1 min-w-0">
            {isFreeAgent ? (
              <div className="flex items-center gap-1.5 mb-2">
                <UserPlus size={14} className="text-neon" />
                <span className="text-xs font-medium text-neon">Free Agent Pool</span>
              </div>
            ) : recipient ? (
              <div className="flex items-center gap-1.5 mb-2">
                <TeamLogo abbrev={recipient.teamAbbrev} color={recipient.teamColor} size="sm" />
                <span className="text-xs font-medium text-text-primary truncate">{recipient.teamAbbrev}</span>
                <span className="text-[10px] text-text-muted">sends</span>
              </div>
            ) : null}
            <div className="space-y-1">
              {trade.requesting.map(name => (
                <PokemonRow
                  key={name}
                  name={name}
                  tier={isFreeAgent ? 0 : findTier(name, trade.recipient)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PokemonRow({ name, tier }: { name: string; tier: number }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <PokemonSprite name={name} size="xs" className="shrink-0" />
      <span className="text-xs text-text-primary truncate flex-1">{name}</span>
      {tier > 0 && <TierBadge points={tier} />}
    </div>
  );
}
