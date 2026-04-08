import { useState, useEffect, useMemo } from 'react';
import { ExternalLink, Film, Search, Play, X, Maximize2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ApiMatch, ApiTeam } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import type { League } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ReplayEntry {
  match: ApiMatch;
  league: League;
  homeTeam: ApiTeam | undefined;
  awayTeam: ApiTeam | undefined;
}

export function ReplaysPage() {
  const { leagues, loading: leaguesLoading } = useAppData();
  const [entries, setEntries] = useState<ReplayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [leagueFilter, setLeagueFilter] = useState<Set<string>>(new Set());
  const [viewingReplay, setViewingReplay] = useState<ReplayEntry | null>(null);

  // Fetch all schedules + teams across leagues
  useEffect(() => {
    if (leaguesLoading || leagues.length === 0) return;

    setLoading(true);
    Promise.all(
      leagues.map(async (league) => {
        const [schedule, teams] = await Promise.all([
          api.getSchedule(league.id).catch(() => ({ matches: [] as ApiMatch[], byes: [] })),
          api.getTeams(league.id).catch(() => [] as ApiTeam[]),
        ]);

        const teamMap = new Map(teams.map(t => [t.id, t]));

        return schedule.matches
          .filter(m => m.replayUrl && m.replayUrl !== '#')
          .map(m => ({
            match: m,
            league,
            homeTeam: teamMap.get(m.homePlayer),
            awayTeam: teamMap.get(m.awayPlayer),
          }));
      }),
    ).then(results => {
      setEntries(results.flat());
      setLoading(false);
    });
  }, [leagues, leaguesLoading]);

  // Filter + group
  const filtered = useMemo(() => {
    let result = entries;

    if (leagueFilter.size > 0) {
      result = result.filter(e => leagueFilter.has(e.league.id));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        (e.homeTeam?.teamName?.toLowerCase().includes(q)) ||
        (e.awayTeam?.teamName?.toLowerCase().includes(q)) ||
        (e.homeTeam?.name?.toLowerCase().includes(q)) ||
        (e.awayTeam?.name?.toLowerCase().includes(q)) ||
        (e.homeTeam?.teamAbbrev?.toLowerCase().includes(q)) ||
        (e.awayTeam?.teamAbbrev?.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [entries, search, leagueFilter]);

  // Group by week (descending)
  const grouped = useMemo(() => {
    const map = new Map<number, ReplayEntry[]>();
    for (const entry of filtered) {
      const week = entry.match.week;
      if (!map.has(week)) map.set(week, []);
      map.get(week)!.push(entry);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  function toggleLeagueFilter(id: string) {
    setLeagueFilter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Check if a replay URL can be safely iframed.
  // Includes both relative `/replay…` paths (legacy) and the configured PS
  // sim host (which sets `frame-ancestors 'self' https://cannoli.live` per
  // showdown/nginx.conf).
  function isLocalReplay(url: string) {
    if (url.startsWith('/replays/') || url.startsWith('/replay')) return true;
    const psUrl = (import.meta.env.VITE_SHOWDOWN_URL as string | undefined) || 'https://sim.cannoli.live';
    try {
      const psHost = new URL(psUrl).host;
      const u = new URL(url);
      return u.host === psHost;
    } catch {
      return false;
    }
  }

  return (
    <div className="flex flex-col h-full">
      <h1 className="font-mono text-xl font-bold uppercase tracking-widest mb-4">
        <span className="text-neon">Replay</span>{' '}
        <span className="text-text-primary">Gallery</span>
      </h1>

      {/* Replay viewer panel */}
      {viewingReplay && (
        <div className="mb-4 rounded-lg border border-neon/20 bg-surface-raised overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-surface-overlay border-b border-border-subtle">
            <div className="flex items-center gap-2 text-xs">
              <Play size={12} className="text-neon" />
              <span className="font-semibold text-text-primary">
                {viewingReplay.homeTeam?.teamAbbrev ?? 'Home'} vs {viewingReplay.awayTeam?.teamAbbrev ?? 'Away'}
              </span>
              <span className="text-text-muted">
                — W{viewingReplay.match.week}
              </span>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ color: viewingReplay.league.color, backgroundColor: `${viewingReplay.league.color}15` }}
              >
                {viewingReplay.league.name.replace(' League', '')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {isLocalReplay(viewingReplay.match.replayUrl!) && (
                <a
                  href={viewingReplay.match.replayUrl!}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1 text-text-muted hover:text-neon transition-colors"
                  title="Open in new tab"
                >
                  <Maximize2 size={13} />
                </a>
              )}
              <button
                onClick={() => setViewingReplay(null)}
                className="p-1 text-text-muted hover:text-loss transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {isLocalReplay(viewingReplay.match.replayUrl!) ? (
            <iframe
              src={viewingReplay.match.replayUrl!}
              className="w-full border-0 bg-white"
              style={{ height: '500px' }}
              title="Replay viewer"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              <a
                href={viewingReplay.match.replayUrl!}
                target="_blank"
                rel="noreferrer"
                className="text-neon hover:underline flex items-center gap-1"
              >
                <ExternalLink size={14} />
                Open replay on Pokemon Showdown
              </a>
            </div>
          )}
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search teams, players..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-md bg-surface-raised border border-border-default text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neon/50"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {leagues.map(league => {
            const active = leagueFilter.has(league.id);
            return (
              <button
                key={league.id}
                onClick={() => toggleLeagueFilter(league.id)}
                className={cn(
                  'text-[10px] font-bold px-2 py-1 rounded-full border transition-colors cursor-pointer',
                  active
                    ? 'border-transparent'
                    : 'border-border-default text-text-muted hover:text-text-secondary',
                )}
                style={active ? {
                  color: league.color,
                  backgroundColor: `${league.color}20`,
                  borderColor: `${league.color}40`,
                } : undefined}
              >
                {league.name.replace(' League', '')}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-text-muted text-sm py-12 text-center">Loading replays...</div>
      ) : entries.length === 0 ? (
        <div className="text-text-muted text-sm py-12 text-center flex flex-col items-center gap-2">
          <Film size={32} className="text-text-muted/40" />
          No replays available yet.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-text-muted text-sm py-12 text-center">No replays match your search.</div>
      ) : (
        <div className="space-y-5 flex-1 overflow-y-auto">
          {grouped.map(([week, weekEntries]) => (
            <div key={week}>
              <h2 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-text-muted mb-2">
                Week {week}
              </h2>
              <div className="space-y-1">
                {weekEntries.map(({ match, league, homeTeam, awayTeam }) => {
                  const entry = { match, league, homeTeam, awayTeam };
                  const isViewing = viewingReplay?.match.id === match.id;
                  return (
                    <div
                      key={match.id}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors',
                        isViewing
                          ? 'bg-neon/5 border-neon/20'
                          : 'bg-surface-raised border-border-default hover:border-border-default/80',
                      )}
                    >
                      <span className="text-[10px] font-mono text-text-muted w-8 shrink-0">
                        W{match.week}
                      </span>

                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                        style={{ color: league.color, backgroundColor: `${league.color}15` }}
                      >
                        {league.name.replace(' League', '')}
                      </span>

                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Link
                          to={`/league/${league.id}/teams/${homeTeam?.id}`}
                          className="text-sm font-medium text-text-primary hover:text-neon transition-colors truncate"
                        >
                          {homeTeam?.teamAbbrev ?? match.homePlayer}
                        </Link>

                        <span className="text-[11px] font-mono tabular-nums text-text-muted shrink-0">
                          {match.homeScore}-{match.awayScore}
                        </span>

                        <Link
                          to={`/league/${league.id}/teams/${awayTeam?.id}`}
                          className="text-sm font-medium text-text-primary hover:text-neon transition-colors truncate"
                        >
                          {awayTeam?.teamAbbrev ?? match.awayPlayer}
                        </Link>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setViewingReplay(isViewing ? null : entry)}
                          className={cn(
                            'flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded transition-colors',
                            isViewing
                              ? 'text-neon bg-neon/10'
                              : 'text-text-muted hover:text-neon hover:bg-neon/5',
                          )}
                        >
                          <Play size={11} />
                          {isViewing ? 'Playing' : 'Watch'}
                        </button>
                        <a
                          href={match.replayUrl!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-text-muted hover:text-neon transition-colors p-1"
                          title="Open replay"
                        >
                          <ExternalLink size={13} />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Count */}
      {!loading && filtered.length > 0 && (
        <p className="text-[10px] text-text-muted mt-4">
          {filtered.length} replay{filtered.length !== 1 ? 's' : ''} found
        </p>
      )}
    </div>
  );
}
