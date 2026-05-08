import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { ArrowRight, Archive as ArchiveIcon, Trophy, Crown, Skull, BarChart3, CalendarDays, Medal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MEDAL_COLORS } from '@/lib/constants';
import { pokemonRoute } from '@/lib/pokemon-route';

/**
 * /archive — top-level archive hub. Three stacked sections:
 *
 *   1. Trophy case — every champion ever, grouped by season as a horizontal strip
 *   2. All-time leaders — 4 small leaderboard cards (kills, K/D, championships, tenure)
 *   3. Season grid — every season as a card linking to /archive/:seasonId
 *
 * All data comes from one /api/archive/all-time call. Cross-season Pokemon
 * search deferred — the per-Pokemon list is rendered directly under the
 * leaders so it's still browsable.
 */

interface AllTimePayload {
  seasons: {
    id: number;
    seasonNumber: number;
    pointCap: number;
    teraCaptainSlots: number;
    archived: boolean;
    leagueCount: number;
  }[];
  champions: {
    seasonNumber: number;
    seasonId: number;
    leagueId: string;
    leagueName: string;
    leagueColor: string;
    teamId: string;
    teamName: string;
    teamAbbrev: string;
    teamColor: string;
    coachName: string;
    userId: number | null;
  }[];
  allTimeLeaders: {
    mostKills: LeaderRow[];
    mostChampionships: LeaderRow[];
    mostAppearances: LeaderRow[];
    bestKD: LeaderRow[];
  };
  perPokemon: {
    pokemonName: string;
    totalKills: number;
    totalDeaths: number;
    gp: number;
    seasonsDrafted: number;
  }[];
}

interface LeaderRow {
  userId: number;
  coachName: string;
  totalKills: number;
  totalDeaths: number;
  gp: number;
  kdRatio: number;
  championships: number;
  seasonsPlayed: number;
}

export function ArchiveHubPage() {
  const [data, setData] = useState<AllTimePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/archive/all-time')
      .then(r => r.json())
      .then((d: AllTimePayload) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Group champions by season for the trophy case strip.
  const championsBySeason = useMemo(() => {
    if (!data) return new Map<number, AllTimePayload['champions']>();
    const m = new Map<number, AllTimePayload['champions']>();
    for (const c of data.champions) {
      if (!m.has(c.seasonNumber)) m.set(c.seasonNumber, []);
      m.get(c.seasonNumber)!.push(c);
    }
    return m;
  }, [data]);

  if (loading) return <div className="text-text-muted py-20 text-center text-sm">Loading archive…</div>;
  if (!data) return <div className="text-text-muted py-20 text-center">Archive unavailable.</div>;

  const hasAnyData = data.seasons.length > 0;
  const hasChampions = data.champions.length > 0;
  const hasLeaders = data.allTimeLeaders.mostKills.length > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-purple-400">Record</span>{' '}
          <span className="text-text-primary">Book</span>
        </h1>
        <p className="text-sm text-text-muted">Every season, every champion, every record</p>
      </div>

      {!hasAnyData && (
        <div className="rounded-xl border border-border-default bg-surface-raised/40 py-16 px-6 flex flex-col items-center justify-center text-center">
          <div className="rounded-full p-4 bg-purple-400/5 border border-purple-400/20 mb-4">
            <ArchiveIcon size={28} className="text-purple-400/70" />
          </div>
          <h2 className="text-base font-medium text-text-primary mb-1">No seasons yet</h2>
          <p className="text-sm text-text-muted max-w-sm">
            Once a season is archived, it'll appear here with full league deep-dives.
          </p>
        </div>
      )}

      {/* ─── Trophy case ────────────────────────────────────────────── */}
      {hasChampions && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={14} className="text-draw" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Trophy case</span>
          </div>
          <div className="space-y-2">
            {[...championsBySeason.entries()]
              .sort((a, b) => b[0] - a[0])
              .map(([seasonNumber, champions]) => (
                <div key={seasonNumber} className="flex items-center gap-3">
                  <Link
                    to={`/archive/${champions[0]!.seasonId}`}
                    className="font-mono font-bold text-sm text-purple-400 w-12 shrink-0 hover:underline"
                  >
                    S{seasonNumber}
                  </Link>
                  <div className="flex gap-2 flex-wrap">
                    {champions.map(c => (
                      <Link
                        key={c.leagueId}
                        to={`/archive/${c.seasonId}/${c.leagueId}/${c.teamId}`}
                        className="flex items-center gap-2 rounded-md border border-border-default bg-surface-raised px-2.5 py-1.5 hover:border-draw/40 transition-colors group"
                        style={{ borderLeftColor: c.leagueColor, borderLeftWidth: 3 }}
                      >
                        <Crown size={12} className="text-draw shrink-0" />
                        <span className="text-xs font-medium text-text-primary group-hover:text-draw transition-colors truncate">
                          {c.teamName}
                        </span>
                        <span className="text-[10px] text-text-muted">·</span>
                        <span className="text-[10px] text-text-muted truncate">{c.coachName}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ─── All-time leaders ─────────────────────────────────────── */}
      {hasLeaders && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-purple-400" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">All-time leaders</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <LeaderCard
              title="Most Kills"
              icon={Skull}
              tint="#ef4444"
              rows={data.allTimeLeaders.mostKills}
              format={r => `${r.totalKills}K`}
            />
            <LeaderCard
              title="Best K/D"
              icon={BarChart3}
              tint="#10b981"
              rows={data.allTimeLeaders.bestKD}
              format={r => r.kdRatio.toFixed(2)}
              hint="min 10 GP"
            />
            <LeaderCard
              title="Most Championships"
              icon={Trophy}
              tint="#fbbf24"
              rows={data.allTimeLeaders.mostChampionships}
              format={r => `${r.championships} · ${r.seasonsPlayed}s`}
            />
            <LeaderCard
              title="Most Seasons"
              icon={CalendarDays}
              tint="#a855f7"
              rows={data.allTimeLeaders.mostAppearances}
              format={r => `${r.seasonsPlayed}s · ${r.gp}gp`}
            />
          </div>
        </section>
      )}

      {/* ─── All-time per-Pokemon ─────────────────────────────────── */}
      {data.perPokemon.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Medal size={14} className="text-orange-400" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">All-time Pokemon leaders</span>
          </div>
          <Card className="bg-surface-raised border-border-default">
            <CardContent className="p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-1">
                {data.perPokemon.slice(0, 24).map((p, i) => (
                  <Link
                    key={p.pokemonName}
                    to={pokemonRoute(p.pokemonName)}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-overlay/50 transition-colors text-xs"
                  >
                    <span className="font-mono text-[10px] w-5 text-right text-text-muted">{i + 1}</span>
                    <PokemonSprite name={p.pokemonName} size="xs" />
                    <span className="flex-1 truncate text-text-primary">{p.pokemonName}</span>
                    <span className="font-mono text-text-muted text-[10px]">
                      {p.totalKills}K · {p.gp}gp
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ─── Season grid ─────────────────────────────────────────── */}
      {hasAnyData && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays size={14} className="text-blue-400" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Seasons ({data.seasons.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.seasons.map(season => {
              const seasonChampions = data.champions.filter(c => c.seasonNumber === season.seasonNumber);
              return (
                <Link
                  key={season.id}
                  to={`/archive/${season.id}`}
                  className={cn(
                    'group rounded-xl border bg-surface-raised hover:bg-surface-overlay/50 transition-colors',
                    season.archived ? 'border-border-default' : 'border-border-default/60',
                  )}
                >
                  <Card className="border-0 bg-transparent shadow-none">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-lg font-bold text-purple-400">S{season.seasonNumber}</span>
                          {season.archived ? (
                            <Badge variant="outline" className="text-[9px] text-text-muted border-border-default uppercase tracking-wider">
                              Archived
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-400/30 uppercase tracking-wider">
                              Active
                            </Badge>
                          )}
                        </div>
                        <ArrowRight size={14} className="text-text-muted group-hover:text-text-primary transition-colors" />
                      </div>

                      <div className="text-[11px] text-text-muted flex items-center gap-2">
                        <span>{season.leagueCount} leagues</span>
                        <span>·</span>
                        <span>{season.pointCap}pt cap</span>
                        <span>·</span>
                        <span>{season.teraCaptainSlots} captains</span>
                      </div>

                      {seasonChampions.length > 0 ? (
                        <div className="border-t border-border-subtle pt-2 space-y-1">
                          <div className="text-[9px] uppercase tracking-wider text-text-muted">Champions</div>
                          {seasonChampions.map(c => (
                            <div key={c.leagueId} className="flex items-center gap-1.5 text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.leagueColor }} />
                              <span className="font-medium text-text-primary truncate">{c.coachName}</span>
                              <span className="text-text-muted truncate">· {c.teamName}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border-t border-border-subtle pt-2">
                          <div className="text-[10px] text-text-muted italic">In progress</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function LeaderCard({
  title, icon: Icon, tint, rows, format, hint,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tint: string;
  rows: LeaderRow[];
  format: (r: LeaderRow) => string;
  hint?: string;
}) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Icon size={12} style={{ color: tint }} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{title}</span>
          </div>
          {hint && <span className="text-[9px] text-text-muted/70 italic">{hint}</span>}
        </div>
        {rows.length === 0 ? (
          <div className="text-[11px] text-text-muted italic">No data yet</div>
        ) : (
          <ol className="space-y-0.5">
            {rows.slice(0, 5).map((r, i) => (
              <li key={r.userId} className="flex items-center gap-2 text-[11px]">
                <span
                  className={cn(
                    'font-mono w-3 text-center font-bold',
                    i === 0 ? 'text-draw' : i === 1 ? 'text-text-secondary' : '',
                  )}
                  style={i === 2 ? { color: MEDAL_COLORS.bronze } : undefined}
                >
                  {i + 1}
                </span>
                <Link
                  to={`/coach/${r.coachName.toLowerCase().replace(/\s+/g, '')}`}
                  className="flex-1 truncate text-text-primary hover:text-neon hover:underline"
                >
                  {r.coachName}
                </Link>
                <span className="font-mono text-text-muted text-[10px]">{format(r)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
