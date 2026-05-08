import type { Player } from '@/lib/types';
import { Link } from 'react-router-dom';
import { TeamLogo } from '@/components/team-logo';
import { TeamCoach } from '@/components/team-coach';
import { CoachAvatar } from '@/components/coach-avatar';
import { RecordDisplay } from '@/components/record-display';
import { FlaskConical, ArrowLeft } from 'lucide-react';
import { RankBadge } from './rank-badge';

interface HeaderStripProps {
  player: Player;
  rank: number;
  theorycraftMode: boolean;
  onToggleTheorycraft: () => void;
  teamKills: number;
  teamDeaths: number;
}

/**
 * Team header strip. Pairs the team identity (logo + name + abbrev) with a
 * prominent "Coach: NAME" jump-link back to the canonical coach profile —
 * the team and coach pages cross-reference each other so visitors landing
 * on a deep team URL can hop to the human behind it in one click.
 *
 * Design: replaces the previous gemstone-gradient banner with a quieter
 * team-color accent (thin top strip + a subtle 135° wash), aligned with
 * the new coach-profile identity treatment. The avatar of the coach gets
 * a small team-color glow ring so the affiliation reads in two places.
 */
export function HeaderStrip({
  player,
  rank,
  theorycraftMode,
  onToggleTheorycraft,
  teamKills,
  teamDeaths,
}: HeaderStripProps) {
  return (
    <div
      className="identity-glow-soft relative rounded-lg overflow-hidden border border-border-default bg-surface-raised"
      style={{ ['--identity-color' as never]: player.teamColor }}
    >
      {/* Thin team-color accent strip — the only color treatment up top.
          Kept to 3px so it reads as identity, not chrome. */}
      <div
        className="h-[3px]"
        style={{
          background: `linear-gradient(90deg, ${player.teamColor}cc, ${player.teamColor}30 60%, transparent)`,
        }}
      />

      {/* Coach jump-link — sits above the team title so visitors landing
          on a deep team URL can hop back to the human behind it without
          hunting through the page. The avatar of the coach echoes the
          team color via the avatar's outer ring. */}
      {player.owner && (
        <Link
          to={`/coach/${encodeURIComponent(player.owner.username)}`}
          viewTransition
          className="flex items-center gap-2 px-5 pt-3 pb-1 text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-neon transition-colors group"
        >
          <ArrowLeft size={11} className="shrink-0" />
          <span className="shrink-0">Coach:</span>
          <CoachAvatar
            username={player.owner.username}
            displayName={player.owner.displayName}
            avatarPath={player.owner.avatarPath}
            primaryColor={player.owner.primaryColor}
            secondaryColor={player.owner.secondaryColor}
            size="sm"
            ringColor={player.teamColor}
          />
          <span className="text-text-secondary group-hover:text-neon transition-colors truncate normal-case tracking-normal">
            {player.owner.displayName ?? player.owner.username}
          </span>
        </Link>
      )}

      <div className="px-5 pt-2 pb-3 flex items-center gap-4">
        <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="lg" className="w-12 h-12 text-xs shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-heading font-bold text-text-primary tracking-tight leading-none">{player.teamName}</h1>
          {/* Coach + abbrev sub-line — kept around for the legacy non-owner
              fallback (TeamCoach renders plain text when owner is null) and
              because the abbrev is a useful identity anchor on small screens
              where the new top jump-link wraps off. */}
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
      <div className="mx-5 mb-4 rounded-lg bg-surface-overlay/40 border border-border-default overflow-hidden">
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
