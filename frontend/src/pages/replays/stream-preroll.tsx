import { useEffect, useState } from 'react';
import { Bookmark, Crown, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import type { League } from '@/lib/types';
import type { ApiTeam } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PrerollProps {
  league: League;
  week: number;
  matchIndex: number;
  total: number;
  homeTeam: ApiTeam | undefined;
  awayTeam: ApiTeam | undefined;
  /** Pre-computed standings position (1-indexed) of each team going into this match. */
  homeRank?: number;
  awayRank?: number;
  durationMs: number;
  isFeatured: boolean;
  onAdvance: () => void;
  onSkip: () => void;
  onHold: (held: boolean) => void;
  onReplay: () => void;
  /** When true, pauses the auto-advance countdown. */
  held: boolean;
}

/**
 * Theater-mode pre-roll. Auto-advances after `durationMs` unless held.
 * Auto-advance runs off a single timer that's reset whenever `held`
 * toggles or the matchIndex changes (parent re-keys).
 */
export function StreamPreroll({
  league,
  week,
  matchIndex,
  total,
  homeTeam,
  awayTeam,
  homeRank,
  awayRank,
  durationMs,
  isFeatured,
  onAdvance,
  onSkip,
  onHold,
  onReplay,
  held,
}: PrerollProps) {
  const [progress, setProgress] = useState(0);

  // Drive a 50ms tick to animate the progress bar; advance when full.
  useEffect(() => {
    if (held) return;
    const start = performance.now();
    const startProgress = progress;
    let raf = 0;
    const step = (now: number) => {
      const elapsed = now - start;
      const next = Math.min(1, startProgress + elapsed / durationMs);
      setProgress(next);
      if (next >= 1) {
        onAdvance();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Intentionally exclude `progress` so we don't restart every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, durationMs, onAdvance]);

  const homeRecord = homeTeam ? `${homeTeam.record.wins}-${homeTeam.record.losses}` : '0-0';
  const awayRecord = awayTeam ? `${awayTeam.record.wins}-${awayTeam.record.losses}` : '0-0';

  return (
    <div className="fixed inset-0 z-40 bg-surface flex items-center justify-center overflow-hidden">
      {/* Subtle ambient league-color glow */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 40%, ${league.color}40, transparent 60%)`,
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-10 px-12 max-w-5xl w-full">
        {/* League banner top */}
        <div className="gem-wrapper">
          <div className={`league-banner league-banner-${league.id}`}>
            <span className="league-banner-text text-white text-[16px] tracking-[0.22em]">
              {league.name.replace(' League', '')}
            </span>
          </div>
        </div>

        {/* Week / match heading — split-color mono */}
        <h1
          className={cn(
            'font-mono font-bold uppercase tracking-[0.25em] text-center',
            isFeatured ? 'text-5xl' : 'text-3xl',
          )}
        >
          <span className="text-neon">Week {week}</span>
          <span className="text-text-muted mx-3">/</span>
          <span className="text-text-primary">
            Match {matchIndex + 1} of {total}
          </span>
        </h1>

        {isFeatured && (
          <div className="flex items-center gap-2 -mt-6 px-3 py-1.5 rounded-full border border-neon/30 bg-neon/5">
            <Crown size={14} className="text-neon" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-neon">
              Featured Match
            </span>
            <Bookmark size={12} className="text-neon" />
          </div>
        )}

        {/* Teams row */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-12 w-full">
          {/* Home */}
          <TeamSide
            team={homeTeam}
            record={homeRecord}
            rank={homeRank}
            align="right"
          />

          {/* VS divider */}
          <div className="flex flex-col items-center gap-2">
            <div className="font-mono font-bold text-text-muted text-2xl tracking-widest">VS</div>
            <div className="w-px h-12 bg-gradient-to-b from-transparent via-border-default to-transparent" />
          </div>

          {/* Away */}
          <TeamSide
            team={awayTeam}
            record={awayRecord}
            rank={awayRank}
            align="left"
          />
        </div>

        {/* Progress + controls */}
        <div className="w-full max-w-2xl flex flex-col items-center gap-3">
          <div className="w-full h-0.5 bg-border-default/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-neon transition-[width] ease-linear"
              style={{
                width: `${progress * 100}%`,
                transitionDuration: held ? '0ms' : '50ms',
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <PrerollButton onClick={onReplay} icon={<RotateCcw size={14} />}>Replay</PrerollButton>
            <PrerollButton
              onClick={() => onHold(!held)}
              icon={held ? <Play size={14} /> : <Pause size={14} />}
              accent={held}
            >
              {held ? 'Resume' : 'Hold'}
            </PrerollButton>
            <PrerollButton onClick={onSkip} icon={<SkipForward size={14} />}>Skip</PrerollButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamSide({
  team,
  record,
  rank,
  align,
}: {
  team: ApiTeam | undefined;
  record: string;
  rank?: number;
  align: 'left' | 'right';
}) {
  const color = team?.teamColor ?? '#6b7280';
  const abbrev = team?.teamAbbrev ?? '???';
  const name = team?.teamName ?? 'Unknown';

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3',
        align === 'right' ? 'md:items-end' : 'md:items-start',
      )}
    >
      <TeamLogo
        abbrev={abbrev}
        color={color}
        logoPath={team?.logoPath ?? null}
        size="xl"
      />
      <div
        className={cn(
          'flex flex-col gap-0.5',
          align === 'right' ? 'md:items-end' : 'md:items-start',
          'items-center',
        )}
      >
        <span
          className="text-2xl font-bold leading-tight tracking-tight"
          style={{ color }}
        >
          {name}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          {record}
          {rank ? <span className="ml-2 text-text-secondary">#{rank}</span> : null}
        </span>
      </div>
    </div>
  );
}

function PrerollButton({
  onClick,
  icon,
  children,
  accent,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[11px] font-mono uppercase tracking-widest transition-colors',
        accent
          ? 'border-neon/40 text-neon bg-neon/5 hover:bg-neon/10'
          : 'border-border-default text-text-secondary hover:text-text-primary hover:border-border-default/80',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
