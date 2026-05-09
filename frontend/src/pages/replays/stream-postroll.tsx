import { useEffect, useState } from 'react';
import { ChevronRight, Sparkles, Swords, Zap } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { TeamCoachVs } from '@/components/team-coach-vs';
import { api } from '@/lib/api';
import type { ApiMatch, ApiMatchPokemon, ApiTeam } from '@/lib/api';
import type { League } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PostrollProps {
  match: ApiMatch;
  league: League;
  homeTeam: ApiTeam | undefined;
  awayTeam: ApiTeam | undefined;
  durationMs: number;
  onContinue: () => void;
}

interface MvpInfo {
  name: string;
  kills: number;
  deaths: number;
  teamAbbrev: string;
  teamColor: string;
  teraUsed: boolean;
}

interface MatchStats {
  mvp: MvpInfo | null;
  teraCount: number;
  totalKills: number;
}

/**
 * Brief 8-second mini-card shown after a replay finishes. Pulls top
 * K-getter from /matches/:id/pokemon when available; degrades to just
 * the score if not.
 */
export function StreamPostroll({ match, league, homeTeam, awayTeam, durationMs, onContinue }: PostrollProps) {
  const [stats, setStats] = useState<MatchStats | null>(null);
  const [progress, setProgress] = useState(0);

  // Fetch MVP / tera info
  useEffect(() => {
    let cancelled = false;
    api.getMatchPokemon(match.id)
      .then(({ home, away }) => {
        if (cancelled) return;
        const all: { side: 'home' | 'away'; mon: ApiMatchPokemon }[] = [
          ...home.map(mon => ({ side: 'home' as const, mon })),
          ...away.map(mon => ({ side: 'away' as const, mon })),
        ];
        const teraCount = all.filter(({ mon }) => mon.teraUsed).length;
        const totalKills = all.reduce((sum, { mon }) => sum + mon.kills, 0);

        const top = all.reduce<{ side: 'home' | 'away'; mon: ApiMatchPokemon } | null>((best, cur) => {
          if (!best) return cur;
          if (cur.mon.kills > best.mon.kills) return cur;
          return best;
        }, null);

        let mvp: MvpInfo | null = null;
        if (top && top.mon.kills > 0) {
          const team = top.side === 'home' ? homeTeam : awayTeam;
          mvp = {
            name: top.mon.name,
            kills: top.mon.kills,
            deaths: top.mon.deaths,
            teamAbbrev: team?.teamAbbrev ?? top.side.toUpperCase(),
            teamColor: team?.teamColor ?? '#6b7280',
            teraUsed: top.mon.teraUsed,
          };
        }

        setStats({ mvp, teraCount, totalKills });
      })
      .catch(() => {
        if (!cancelled) setStats({ mvp: null, teraCount: 0, totalKills: 0 });
      });
    return () => { cancelled = true; };
  }, [match.id, homeTeam, awayTeam]);

  // Auto-advance progress
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const next = Math.min(1, (now - start) / durationMs);
      setProgress(next);
      if (next >= 1) {
        onContinue();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, onContinue]);

  const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayWon = (match.awayScore ?? 0) > (match.homeScore ?? 0);

  return (
    <div className="fixed inset-0 z-40 bg-surface flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${league.color}40, transparent 70%)`,
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-10 px-12 max-w-4xl w-full">
        <h1 className="font-mono font-bold uppercase tracking-[0.25em] text-center text-2xl">
          <span className="text-neon">Final</span>{' '}
          <span className="text-text-primary">Score</span>
        </h1>

        {/* Score row */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-10 w-full">
          <ScoreSide team={homeTeam} score={match.homeScore} won={homeWon} align="right" side="home" leagueId={league.id} />
          <span className="font-mono text-2xl tracking-widest text-text-muted">vs</span>
          <ScoreSide team={awayTeam} score={match.awayScore} won={awayWon} align="left" side="away" leagueId={league.id} />
        </div>

        {/* MVP card */}
        {stats?.mvp && (
          <div className="flex items-center gap-4 px-5 py-3 rounded-lg border border-neon/20 bg-surface-raised">
            <Sparkles size={18} className="text-neon shrink-0" />
            <img
              src={`https://play.pokemonshowdown.com/sprites/gen5/${slugForSprite(stats.mvp.name)}.png`}
              alt={stats.mvp.name}
              className="w-12 h-12 object-contain pixelated"
              style={{ imageRendering: 'pixelated' }}
              onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
            />
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">MVP</span>
                <span
                  className="font-mono text-[10px] uppercase tracking-widest"
                  style={{ color: stats.mvp.teamColor }}
                >
                  {stats.mvp.teamAbbrev}
                </span>
                {stats.mvp.teraUsed && (
                  <span className="flex items-center gap-0.5 font-mono text-[9px] uppercase tracking-widest text-neon">
                    <Zap size={10} /> Tera
                  </span>
                )}
              </div>
              <div className="text-lg font-semibold text-text-primary">
                {stats.mvp.name}
              </div>
              <div className="font-mono text-[11px] tabular-nums text-text-secondary">
                <Swords size={10} className="inline mr-1 -mt-0.5" />
                {stats.mvp.kills} K · {stats.mvp.deaths} D
              </div>
            </div>
          </div>
        )}

        {/* Aggregate strip */}
        {stats && (stats.teraCount > 0 || stats.totalKills > 0) && (
          <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-widest text-text-muted">
            {stats.totalKills > 0 && (
              <span className="flex items-center gap-1.5">
                <Swords size={12} />
                {stats.totalKills} kills
              </span>
            )}
            {stats.teraCount > 0 && (
              <span className="flex items-center gap-1.5">
                <Zap size={12} className="text-neon" />
                {stats.teraCount} tera{stats.teraCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {/* Continue button + progress */}
        <div className="flex flex-col items-center gap-3 w-full max-w-md">
          <button
            onClick={onContinue}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-neon/40 bg-neon/5 hover:bg-neon/10 text-neon font-mono text-[11px] uppercase tracking-widest transition-colors"
          >
            Continue
            <ChevronRight size={14} />
          </button>
          <div className="w-full h-0.5 bg-border-default/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-neon"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreSide({
  team,
  score,
  won,
  align,
  side,
  leagueId,
}: {
  team: ApiTeam | undefined;
  score: number | null;
  won: boolean;
  align: 'left' | 'right';
  side: 'home' | 'away';
  leagueId: string;
}) {
  const color = team?.teamColor ?? '#6b7280';
  return (
    <div
      className={cn(
        'flex items-center gap-4',
        align === 'right' ? 'flex-row-reverse text-right justify-self-end' : 'justify-self-start',
      )}
    >
      {team ? (
        <TeamCoachVs
          team={{
            leagueId,
            teamId: team.id,
            teamAbbrev: team.teamAbbrev,
            teamColor: team.teamColor,
            logoPath: team.logoPath,
            owner: team.owner,
          }}
          side={side}
          size="lg"
        />
      ) : (
        <TeamLogo abbrev="???" color={color} size="lg" />
      )}
      <div className="flex flex-col">
        <span
          className={cn(
            'text-lg font-bold leading-tight',
            won ? '' : 'text-text-muted',
          )}
          style={won ? { color } : undefined}
        >
          {team?.teamName ?? 'Unknown'}
        </span>
        <span
          className={cn(
            'font-mono text-4xl font-bold tabular-nums leading-tight',
            won ? 'text-neon' : 'text-text-muted',
          )}
        >
          {score ?? '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * Showdown sprite filenames are lowercase, with hyphens preserved and
 * apostrophes / dots removed. Forms like 'Tapu Koko' become 'tapukoko'.
 */
function slugForSprite(name: string): string {
  return name.toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[\s_]/g, '')
    .replace(/[^a-z0-9-]/g, '');
}
