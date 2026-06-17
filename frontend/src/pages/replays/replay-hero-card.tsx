import { Suspense } from 'react';
import { Play, Image as ImageIcon, Link2, Flame, Zap, Trophy, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ApiReplaySummary } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { Spoiler } from '@/components/spoiler';
import { leagueGem } from '@/lib/constants';
import { buildGradientCss, gemPaletteFor } from '@/lib/shader-gradient';
import { ShaderField } from '@/components/shader-field-lazy';
import type { ReplayEntry } from './replay-types';
import { BroughtPreview } from './brought-preview';

interface ReplayHeroCardProps {
  entry: ReplayEntry;
  isViewing: boolean;
  summary: ApiReplaySummary | undefined;
  stats: { total: number; sweeps: number; blowouts: number };
  /** False while the league is still on or before this match's week — keeps
   *  MVP/Sweep/Tera spoiler badges hidden until the week's matches are over. */
  weekEnded: boolean;
  onToggleViewing: (entry: ReplayEntry | null) => void;
  onCopyShareLink: (matchId: string) => void;
}

/**
 * Featured hero card at the top of the gallery. Picks the most recent
 * replay (caller passes it in), displays a large preview pane (deliberate
 * empty placeholder until Slice 11C ships), match title, league + week
 * chips, and a prominent Watch CTA.
 */
export function ReplayHeroCard({
  entry,
  isViewing,
  summary,
  stats,
  weekEnded,
  onToggleViewing,
  onCopyShareLink,
}: ReplayHeroCardProps) {
  const { spoilerFreeMode } = useAuth();
  const { match, league, homeTeam, awayTeam } = entry;
  const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayWon = (match.awayScore ?? 0) > (match.homeScore ?? 0);

  const sweep = weekEnded && summary?.sweep;
  const teraHeavy = weekEnded && summary && summary.teraCount >= 3;
  const hasMvp = weekEnded && summary?.mvp && summary.mvp.kills > 0;

  const heroPalette = gemPaletteFor(leagueGem(league.id));

  return (
    <div className="spin-border rounded-xl mb-5" style={{ ['--spin-accent' as never]: league.color }}>
    <div
      className="relative rounded-xl border border-border-default bg-surface-raised overflow-hidden"
      style={{
        ['--card-accent' as never]: league.color,
        background: `linear-gradient(120deg, ${league.color}12 0%, var(--color-surface-raised, #161821) 55%)`,
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-0">
        {/* Left: preview pane — animated shader background (GPU-gated) */}
        <div className="relative flex items-center justify-center min-h-[180px] overflow-hidden border-b md:border-b-0 md:border-r border-border-subtle">
          <Suspense fallback={<div className="absolute inset-0" style={{ background: buildGradientCss(heroPalette) }} />}>
            <ShaderField colors={heroPalette} speed={0.85} className="absolute inset-0" />
          </Suspense>
          {/* Dark scrim so sprites/badges stay legible over the shader */}
          <div className="absolute inset-0 bg-gradient-to-r from-surface-raised/30 via-transparent to-surface-raised/55 pointer-events-none" />

          <div className="relative z-10 flex items-center justify-center">
            {summary && (summary.home.length > 0 || summary.away.length > 0) ? (
              <BroughtPreview
                home={summary.home}
                away={summary.away}
                homeColor={homeTeam?.teamColor}
                awayColor={awayTeam?.teamColor}
                size="md"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-muted/70">
                <ImageIcon size={28} strokeWidth={1.25} />
                <span className="text-[10px] font-mono uppercase tracking-widest">No preview yet</span>
              </div>
            )}
          </div>

          <span className="z-10 absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-neon/10 border border-neon/30 text-neon text-[9px] font-mono font-bold uppercase tracking-widest">
            <Sparkles size={10} />
            Featured
          </span>

          {(sweep || teraHeavy || hasMvp) && (
            <Spoiler as="div" className="z-10 absolute top-3 right-3 flex items-center gap-1.5">
              {hasMvp && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400"
                  title={`MVP: ${summary!.mvp!.name}${summary!.mvp!.nickname ? ` "${summary!.mvp!.nickname}"` : ''} (${summary!.mvp!.kills}K)`}
                >
                  <Trophy size={11} />
                  MVP
                </span>
              )}
              {sweep && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400">
                  <Flame size={11} />
                  Sweep
                </span>
              )}
              {teraHeavy && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-pink/15 text-pink"
                  title={`${summary!.teraCount} teras used`}
                >
                  <Zap size={11} />
                  {summary!.teraCount}
                </span>
              )}
            </Spoiler>
          )}
        </div>

        {/* Right: meta + CTA */}
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            <span
              className="px-1.5 py-0.5 rounded font-bold"
              style={{ color: league.color, backgroundColor: `${league.color}20` }}
            >
              {league.name.replace(' League', '')}
            </span>
            <span className="text-text-muted">Week {match.week}</span>
            {match.phase && match.phase !== 'regular' && (
              <>
                <span className="text-border-default">·</span>
                <span className="text-text-secondary">{match.phase}</span>
              </>
            )}
          </div>

          <div className="flex items-baseline gap-3 text-2xl font-semibold leading-tight">
            <Link
              to={`/league/${league.id}/teams/${homeTeam?.id}`}
              viewTransition
              className={cn(
                'hover:text-neon transition-colors truncate',
                (!spoilerFreeMode && homeWon) ? 'text-win' : 'text-text-primary',
              )}
            >
              {homeTeam?.teamAbbrev ?? match.homePlayer}
            </Link>
            <Spoiler className="text-base font-mono tabular-nums text-text-muted shrink-0">
              <span className={homeWon ? 'text-win' : ''}>{match.homeScore ?? 0}</span>
              {' - '}
              <span className={awayWon ? 'text-win' : ''}>{match.awayScore ?? 0}</span>
            </Spoiler>
            <Link
              to={`/league/${league.id}/teams/${awayTeam?.id}`}
              viewTransition
              className={cn(
                'hover:text-neon transition-colors truncate',
                (!spoilerFreeMode && awayWon) ? 'text-win' : 'text-text-primary',
              )}
            >
              {awayTeam?.teamAbbrev ?? match.awayPlayer}
            </Link>
          </div>

          <div className="text-xs text-text-muted truncate">
            <Link
              to={`/league/${league.id}/teams/${homeTeam?.id}`}
              viewTransition
              className="hover:text-neon transition-colors"
            >
              {homeTeam?.teamName ?? '—'}
            </Link>
            <span className="mx-1.5 text-border-default">vs</span>
            <Link
              to={`/league/${league.id}/teams/${awayTeam?.id}`}
              viewTransition
              className="hover:text-neon transition-colors"
            >
              {awayTeam?.teamName ?? '—'}
            </Link>
          </div>

          {/* Stats strip — total / sweeps / blowouts inside the hero */}
          <div className="flex items-center gap-3 text-[10px] font-mono text-text-muted mt-1">
            <span><span className="text-text-secondary tabular-nums">{stats.total}</span> total</span>
            <span className="text-border-default">·</span>
            <span><span className="text-amber-400 tabular-nums">{stats.sweeps}</span> sweep{stats.sweeps !== 1 && 's'}</span>
            <span className="text-border-default">·</span>
            <span><span className="text-pink tabular-nums">{stats.blowouts}</span> blowout{stats.blowouts !== 1 && 's'}</span>
          </div>

          <div className="flex items-center gap-2 mt-auto pt-2">
            <button
              onClick={() => onToggleViewing(isViewing ? null : entry)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 text-xs font-mono font-bold uppercase tracking-widest px-3 py-2 rounded-md border transition-colors',
                isViewing
                  ? 'text-neon bg-neon/10 border-neon/40'
                  : 'text-neon bg-neon/5 border-neon/40 hover:bg-neon/10',
              )}
            >
              <Play size={13} />
              {isViewing ? 'Playing' : 'Watch Replay'}
            </button>
            <button
              onClick={() => onCopyShareLink(match.id)}
              className="flex items-center justify-center text-text-muted hover:text-neon transition-colors p-2 rounded-md border border-border-default hover:border-neon/40"
              title="Copy share link"
            >
              <Link2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
