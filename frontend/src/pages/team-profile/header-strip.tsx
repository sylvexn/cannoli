import type { Player } from '@/lib/types';
import { Link } from 'react-router-dom';
import { TeamLogo } from '@/components/team-logo';
import { TeamCoach } from '@/components/team-coach';
import { RecordDisplay } from '@/components/record-display';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FlaskConical, ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { RankBadge } from './rank-badge';

interface HeaderStripProps {
  player: Player;
  rank: number;
  theorycraftMode: boolean;
  onToggleTheorycraft: () => void;
  teamKills: number;
  teamDeaths: number;
  /** Viewer can take manager actions (owner OR staff) — gates the Manage button. */
  canManage: boolean;
  onManage: () => void;
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
  canManage,
  onManage,
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
          hunting through the page. Avatar omitted here because TeamCoach
          on the sub-line below already renders one. */}
      {player.owner && (
        <Link
          to={`/coach/${encodeURIComponent(player.owner.username)}`}
          viewTransition
          className="flex items-center gap-2 px-5 pt-3 pb-1 text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-neon transition-colors group"
        >
          <ArrowLeft size={11} className="shrink-0" />
          <span className="shrink-0">Coach:</span>
          <span className="text-text-secondary group-hover:text-neon transition-colors truncate normal-case tracking-normal">
            {player.owner.displayName ?? player.owner.username}
          </span>
        </Link>
      )}

      <div className="px-5 pt-2 pb-3 flex items-center gap-4">
        {player.logoPath ? (
          <Popover>
            <PopoverTrigger
              nativeButton={false}
              openOnHover
              delay={150}
              closeDelay={120}
              render={
                <button
                  type="button"
                  aria-label={`View ${player.teamAbbrev} logo at full size`}
                  className="shrink-0 transition-transform duration-200 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon/60 rounded-full"
                />
              }
            >
              <TeamLogo
                abbrev={player.teamAbbrev}
                color={player.teamColor}
                size="lg"
                logoPath={player.logoPath}
                className="w-12 h-12 text-xs"
              />
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="start"
              sideOffset={10}
              className="p-3 border-border-default bg-surface-raised w-auto"
            >
              <img
                src={player.logoPath}
                alt={`${player.teamAbbrev} full logo`}
                className="block max-w-[280px] max-h-[280px] w-auto h-auto object-contain"
                loading="lazy"
              />
            </PopoverContent>
          </Popover>
        ) : (
          <TeamLogo
            abbrev={player.teamAbbrev}
            color={player.teamColor}
            size="lg"
            logoPath={player.logoPath}
            className="w-12 h-12 text-xs shrink-0"
          />
        )}
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
        <div className="shrink-0 flex items-center gap-2">
          {canManage && (
            <button
              onClick={onManage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-semibold tracking-wider uppercase transition-all bg-surface-overlay/50 text-text-muted border border-border-subtle hover:text-neon hover:border-neon/30"
            >
              <SlidersHorizontal size={11} />
              Manage
            </button>
          )}
          <button
            onClick={onToggleTheorycraft}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-semibold tracking-wider uppercase transition-all ${
              theorycraftMode
                ? 'bg-pink/10 text-pink border border-pink/25'
                : 'bg-surface-overlay/50 text-text-muted border border-border-subtle hover:text-neon hover:border-neon/30'
            }`}
          >
            <FlaskConical size={11} />
            {theorycraftMode ? 'Exit' : 'Theorycraft'}
          </button>
        </div>
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
              {(player.record.wins + player.record.losses) === 0
                ? <span className="text-text-muted">—</span>
                : <>{((player.record.wins / (player.record.wins + player.record.losses)) * 100).toFixed(0)}<span className="text-sm text-text-muted font-normal">%</span></>
              }
            </div>
            <span className="text-[8px] font-semibold text-text-muted uppercase tracking-[0.15em] mt-1.5">Win Rate</span>
          </div>
        </div>
      </div>
    </div>
  );
}
