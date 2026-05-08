import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import { Skull, Heart, BarChart3, Activity, Flame, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MEDAL_COLORS } from '@/lib/constants';
import type { FullLeagueData, LeaderboardAggregate, PeakRow, TeamRow } from '../types';

/** Per-Pokemon leaderboards — six tables surfaced as a grid. Each one
 *  derives from the same /full payload's `aggregates`/`peaks` arrays;
 *  no extra fetches. */
export function LeaderboardsTab({ data }: { data: FullLeagueData }) {
  const teamMap = useMemo(() => new Map(data.teams.map(t => [t.id, t])), [data.teams]);
  const aggs = data.leaderboards.aggregates;

  const mostKills = useMemo(() => [...aggs].sort((a, b) => b.kills - a.kills).slice(0, 10), [aggs]);
  const mostDeaths = useMemo(() => [...aggs].sort((a, b) => b.deaths - a.deaths).slice(0, 10), [aggs]);
  const bestKD = useMemo(
    () => [...aggs].filter(a => a.gp >= 4).sort((a, b) => b.kdRatio - a.kdRatio).slice(0, 10),
    [aggs],
  );
  const mostGP = useMemo(() => [...aggs].sort((a, b) => b.gp - a.gp).slice(0, 10), [aggs]);
  const mostTera = useMemo(
    () => [...aggs].filter(a => a.teraUsed > 0).sort((a, b) => b.teraUsed - a.teraUsed).slice(0, 10),
    [aggs],
  );
  const peaks = data.leaderboards.peaks;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <LeaderTable
        title="Most Kills"
        icon={Skull}
        tint="#ef4444"
        rows={mostKills}
        teamMap={teamMap}
        format={r => `${r.kills}K`}
      />
      <LeaderTable
        title="Best K/D"
        icon={BarChart3}
        tint="#10b981"
        rows={bestKD}
        teamMap={teamMap}
        format={r => `${r.kdRatio.toFixed(2)}`}
        hint="min 4 GP"
      />
      <LeaderTable
        title="Most Appearances"
        icon={Activity}
        tint="#a855f7"
        rows={mostGP}
        teamMap={teamMap}
        format={r => `${r.gp}gp`}
      />
      <LeaderTable
        title="Most Deaths"
        icon={Heart}
        tint="#94a3b8"
        rows={mostDeaths}
        teamMap={teamMap}
        format={r => `${r.deaths}D`}
      />
      <LeaderTable
        title="Most Tera Used"
        icon={Sparkles}
        tint="#f472b6"
        rows={mostTera}
        teamMap={teamMap}
        format={r => `${r.teraUsed}×`}
      />
      <PeakTable peaks={peaks} teamMap={teamMap} />
    </div>
  );
}

function LeaderTable({
  title, icon: Icon, tint, rows, teamMap, format, hint,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string; color?: string }>;
  tint: string;
  rows: LeaderboardAggregate[];
  teamMap: Map<string, TeamRow>;
  format: (r: LeaderboardAggregate) => string;
  hint?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Icon size={12} color={tint} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{title}</span>
          </div>
          {hint && <span className="text-[9px] text-text-muted/70 italic">{hint}</span>}
        </div>
        {rows.map((r, i) => {
          const team = teamMap.get(r.teamId);
          return (
            <div key={`${r.teamId}-${r.pokemonName}`} className="flex items-center gap-1.5 text-[11px] py-0.5">
              <span
                className={cn(
                  'font-mono w-3 text-center font-bold shrink-0',
                  i === 0 ? 'text-draw' : i === 1 ? 'text-text-secondary' : '',
                )}
                style={i === 2 ? { color: MEDAL_COLORS.bronze } : undefined}
              >
                {i + 1}
              </span>
              <PokemonSprite name={r.pokemonName} size="xs" />
              <Link
                to={pokemonRoute(r.pokemonName)}
                className="flex-1 truncate text-text-primary hover:text-neon hover:underline"
              >
                {r.pokemonName}
              </Link>
              {team && (
                <span className="text-[9px] text-text-muted truncate max-w-[60px]">{team.teamAbbrev}</span>
              )}
              <span className="font-mono text-[10px] text-text-muted shrink-0">{format(r)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PeakTable({ peaks, teamMap }: { peaks: PeakRow[]; teamMap: Map<string, TeamRow> }) {
  if (peaks.length === 0) return null;
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-1.5 mb-1">
          <Flame size={12} className="text-orange-500" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Single-game high scores</span>
        </div>
        {peaks.map((p, i) => {
          const team = teamMap.get(p.teamId);
          return (
            <div key={`${p.matchId}-${p.pokemonName}`} className="flex items-center gap-1.5 text-[11px] py-0.5">
              <span
                className={cn(
                  'font-mono w-3 text-center font-bold shrink-0',
                  i === 0 ? 'text-draw' : i === 1 ? 'text-text-secondary' : '',
                )}
                style={i === 2 ? { color: MEDAL_COLORS.bronze } : undefined}
              >
                {i + 1}
              </span>
              <PokemonSprite name={p.pokemonName} size="xs" />
              <Link
                to={pokemonRoute(p.pokemonName)}
                className="flex-1 truncate text-text-primary hover:text-neon hover:underline"
              >
                {p.pokemonName}
              </Link>
              <span className="text-[9px] text-text-muted">
                {p.phase === 'playoffs' ? `PO` : `W${p.week}`}
              </span>
              {team && (
                <span className="text-[9px] text-text-muted truncate max-w-[60px]">{team.teamAbbrev}</span>
              )}
              <span className="font-mono font-bold text-[10px] text-orange-400 shrink-0">{p.kills}K</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
