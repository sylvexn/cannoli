import type { Player } from '@/lib/types';
import { TeamLogo } from '@/components/team-logo';
import { TeamCoach } from '@/components/team-coach';
import { RecordDisplay } from '@/components/record-display';
import { FlaskConical } from 'lucide-react';
import { RankBadge } from './rank-badge';

interface HeaderStripProps {
  player: Player;
  rank: number;
  theorycraftMode: boolean;
  onToggleTheorycraft: () => void;
  teamKills: number;
  teamDeaths: number;
}

export function HeaderStrip({
  player,
  rank,
  theorycraftMode,
  onToggleTheorycraft,
  teamKills,
  teamDeaths,
}: HeaderStripProps) {
  return (
    <div className="relative rounded-lg overflow-hidden" style={{ background: `linear-gradient(135deg, ${player.teamColor}08, ${player.teamColor}03 40%, transparent)` }}>
      {/* Accent bar */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${player.teamColor}cc, ${player.teamColor}30 60%, transparent)` }} />

      <div className="px-5 pt-4 pb-3 flex items-center gap-4">
        <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="lg" className="w-12 h-12 text-xs shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-heading font-bold text-text-primary tracking-tight leading-none">{player.teamName}</h1>
          <p className="text-[11px] text-text-muted mt-1.5 font-medium tracking-wide flex items-center gap-1.5">
            <TeamCoach player={player} showAvatar avatarSize="md" size="sm" />
            <span className="text-border-default">/</span>
            <span>{player.teamAbbrev}</span>
          </p>
        </div>
        <button
          onClick={onToggleTheorycraft}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-semibold tracking-wider uppercase transition-all ${
            theorycraftMode
              ? 'bg-pink/10 text-pink border border-pink/25'
              : 'bg-surface-overlay/50 text-text-muted border border-border-subtle hover:text-neon hover:border-neon/30'
          }`}
        >
          <FlaskConical size={11} />
          {theorycraftMode ? 'Exit' : 'Theorycraft'}
        </button>
      </div>

      {/* Stats strip */}
      <div className="mx-5 mb-4 rounded-lg bg-surface-raised border border-border-default overflow-hidden">
        <div className="flex items-stretch divide-x divide-border-subtle">
          {/* Rank */}
          <div className="flex items-center justify-center px-5 py-3">
            <RankBadge rank={rank} />
          </div>

          {/* Record */}
          <div className="flex-1 flex flex-col items-center justify-center py-3 px-4">
            <div className="font-mono text-lg font-bold tabular-nums tracking-tight leading-none">
              <RecordDisplay wins={player.record.wins} losses={player.record.losses} differential={player.record.differential} />
            </div>
            <span className="text-[8px] font-semibold text-text-muted uppercase tracking-[0.15em] mt-1.5">Record</span>
          </div>

          {/* K/D */}
          <div className="flex-1 flex flex-col items-center justify-center py-3 px-4">
            <div className="font-mono text-lg font-bold tabular-nums tracking-tight leading-none">
              <span className="text-win">{teamKills}</span>
              <span className="text-text-muted/30 mx-0.5">/</span>
              <span className="text-loss">{teamDeaths}</span>
            </div>
            <span className="text-[8px] font-semibold text-text-muted uppercase tracking-[0.15em] mt-1.5">K / D</span>
          </div>

          {/* Win Rate */}
          <div className="flex-1 flex flex-col items-center justify-center py-3 px-4">
            <div className="font-mono text-lg font-bold tabular-nums tracking-tight leading-none text-text-primary">
              {((player.record.wins / (player.record.wins + player.record.losses)) * 100).toFixed(0)}<span className="text-sm text-text-muted font-normal">%</span>
            </div>
            <span className="text-[8px] font-semibold text-text-muted uppercase tracking-[0.15em] mt-1.5">Win Rate</span>
          </div>
        </div>
      </div>
    </div>
  );
}
