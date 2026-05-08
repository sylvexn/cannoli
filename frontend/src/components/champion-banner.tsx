import { Link } from 'react-router-dom';
import { Crown, Trophy } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { cn } from '@/lib/utils';

/**
 * The champion celebration banner — used on /archive/:seasonId (under each
 * league's strip) and on /archive/:seasonId/:leagueId (top of page).
 *
 * Composition:
 *   - League-color accent stripe + soft glow
 *   - Team logo (xl), team name, coach link
 *   - Final-series score line
 *   - Roster avatar wall: every Pokemon on the championship team, scaled
 *     to fit on a single row at small sprite size
 *
 * The component renders nothing if `champion` is null — callers pass the
 * decisive finals winner if any, and a missing/unfinished bracket simply
 * results in no banner.
 */

export interface ChampionBannerData {
  team: {
    id: string;
    coachName: string;
    teamName: string;
    teamAbbrev: string;
    teamColor: string;
    /** Optional — if present, coach name links to /coach/:username. */
    coachUsername?: string | null;
  };
  league: {
    id: string;
    name: string;
    color: string;
    seasonNumber: number | null;
    seasonId: number | null;
  };
  /** Aggregate score across the finals series (best-of-N collapses to a sum). */
  finalScore?: { winner: number; loser: number } | null;
  /** Runner-up team — surfaces a "def. RUN" line under the headline. */
  runnerUp?: { id: string; teamAbbrev: string; teamName: string; teamColor: string } | null;
  /** Roster sprites — order from caller is preserved. */
  roster: { name: string; isTeraCaptain?: boolean }[];
  /** Optional override of the deep-link target for the banner card. */
  href?: string;
  /** Compact variant trims the roster wall + tightens vertical rhythm. */
  compact?: boolean;
}

export function ChampionBanner({
  team, league, finalScore, runnerUp, roster, href, compact,
}: ChampionBannerData) {
  const linkTarget = href ?? (league.seasonId != null
    ? `/archive/${league.seasonId}/${league.id}/${team.id}`
    : `/league/${league.id}/teams/${team.id}`);

  return (
    <Link
      to={linkTarget}
      className={cn(
        'relative block rounded-xl overflow-hidden border bg-surface-raised group',
        'border-border-default hover:border-draw/40 transition-colors',
      )}
      style={{
        boxShadow: `0 0 32px -16px ${league.color}40`,
      }}
    >
      {/* League color stripe */}
      <div className="h-1.5 w-full" style={{ backgroundColor: league.color }} />

      {/* Soft radial glow behind the logo */}
      <div
        className="absolute top-0 left-0 right-0 h-32 opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at top, ${league.color}, transparent 70%)`,
        }}
      />

      <div className={cn('relative flex items-center gap-4', compact ? 'p-3' : 'p-5')}>
        <div className={cn('shrink-0', compact ? 'w-12' : 'w-16')}>
          <TeamLogo
            abbrev={team.teamAbbrev}
            color={team.teamColor}
            size={compact ? 'lg' : 'xl'}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            <Crown size={12} className="text-draw shrink-0" />
            <span className="text-draw">Champion</span>
            <span className="text-text-muted">·</span>
            <span style={{ color: league.color }}>{league.name}</span>
            {league.seasonNumber != null && (
              <>
                <span className="text-text-muted">·</span>
                <span className="text-text-muted">S{league.seasonNumber}</span>
              </>
            )}
          </div>

          <div className={cn(
            'font-heading font-bold truncate',
            compact ? 'text-base' : 'text-xl',
          )} style={{ color: team.teamColor }}>
            {team.teamName}
          </div>

          <div className="flex items-center gap-2 text-xs text-text-muted">
            {team.coachUsername ? (
              <Link
                to={`/coach/${team.coachUsername}`}
                onClick={e => e.stopPropagation()}
                className="hover:text-text-primary hover:underline"
              >
                {team.coachName}
              </Link>
            ) : (
              <span>{team.coachName}</span>
            )}
            {finalScore && (
              <>
                <span>·</span>
                <span className="font-mono text-text-secondary">
                  {finalScore.winner}–{finalScore.loser}
                </span>
              </>
            )}
            {runnerUp && (
              <>
                <span>·</span>
                <span>def.</span>
                <span style={{ color: runnerUp.teamColor }} className="font-medium">
                  {runnerUp.teamAbbrev}
                </span>
              </>
            )}
          </div>
        </div>

        {!compact && roster.length > 0 && (
          <div className="hidden lg:flex items-center gap-0.5 max-w-[280px] flex-wrap shrink-0">
            {roster.slice(0, 12).map(mon => (
              <div key={mon.name} className="relative" title={mon.name}>
                <PokemonSprite name={mon.name} size="sm" />
                {mon.isTeraCaptain && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-purple-400 ring-1 ring-surface-raised" />
                )}
              </div>
            ))}
          </div>
        )}

        <Trophy
          size={compact ? 16 : 20}
          className="text-draw/60 group-hover:text-draw transition-colors shrink-0"
        />
      </div>
    </Link>
  );
}
