import { useState, useEffect, useMemo } from 'react';
import { ExternalLink, Search, Play, Radio, X, Maximize2, Minimize2, Link2, Zap, Flame, Trophy } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ApiMatch, ApiTeam, ApiReplaySummary } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { useAuth } from '@/lib/auth-context';
import type { League } from '@/lib/types';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

interface ReplayEntry {
  match: ApiMatch;
  league: League;
  homeTeam: ApiTeam | undefined;
  awayTeam: ApiTeam | undefined;
}

type TimeFilter = 'this-week' | 'last-week' | 'my-matches' | 'all';

const TIME_FILTERS: { id: TimeFilter; label: string }[] = [
  { id: 'this-week', label: 'This Week' },
  { id: 'last-week', label: 'Last Week' },
  { id: 'my-matches', label: 'My Matches' },
  { id: 'all', label: 'All-Time' },
];

export function ReplaysPage() {
  const { leagues, loading: leaguesLoading } = useAppData();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState<ReplayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [leagueFilter, setLeagueFilter] = useState<Set<string>>(new Set());
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('this-week');
  const [viewingReplay, setViewingReplay] = useState<ReplayEntry | null>(null);
  const [theater, setTheater] = useState(false);
  const [summaries, setSummaries] = useState<Map<string, ApiReplaySummary>>(new Map());

  // Pick the highest active currentWeek across leagues — the natural target
  // for a "this-week stream". Falls back to the highest week with any
  // available replay so the button still works mid-season.
  const streamWeek = useMemo(() => {
    const fromLeagues = leagues.reduce((max, l) => Math.max(max, l.season?.currentWeek ?? 0), 0);
    if (fromLeagues > 0) return fromLeagues;
    const fromReplays = entries.reduce((max, e) => Math.max(max, e.match.week), 0);
    return fromReplays > 0 ? fromReplays : 1;
  }, [leagues, entries]);

  // Highest week with at least one replay — used for "This Week" / "Last Week"
  // so the filters land on something meaningful even if currentWeek hasn't
  // been bumped yet for the latest reported matches.
  const latestReplayWeek = useMemo(
    () => entries.reduce((max, e) => Math.max(max, e.match.week), 0),
    [entries],
  );

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

  // Lazily fetch replay summaries (MVP / sweep / teraCount) for all visible
  // entries. Cached by matchId so filter changes don't re-trigger fetches.
  // Failures are silent — the row falls back to its plain layout.
  useEffect(() => {
    if (entries.length === 0) return;
    let cancelled = false;
    const missing = entries.filter(e => !summaries.has(e.match.id));
    if (missing.length === 0) return;
    Promise.all(
      missing.map(e => api.getReplaySummary(e.match.id).catch(() => null)),
    ).then(results => {
      if (cancelled) return;
      setSummaries(prev => {
        const next = new Map(prev);
        for (let i = 0; i < missing.length; i++) {
          const r = results[i];
          if (r) next.set(missing[i].match.id, r);
        }
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [entries, summaries]);

  // Open a specific replay if ?match=ID is in the URL — for share links
  useEffect(() => {
    const matchId = searchParams.get('match');
    if (matchId && entries.length > 0 && !viewingReplay) {
      const found = entries.find(e => e.match.id === matchId);
      if (found) {
        setViewingReplay(found);
        // If the deep-linked replay is filtered out by current filters,
        // reset filters so the user actually sees the row in context.
        setTimeFilter('all');
      }
    }
  }, [searchParams, entries, viewingReplay]);

  // Filter + group
  const filtered = useMemo(() => {
    let result = entries;

    // League filter
    if (leagueFilter.size > 0) {
      result = result.filter(e => leagueFilter.has(e.league.id));
    }

    // Time filter
    if (timeFilter !== 'all') {
      result = result.filter(e => {
        if (timeFilter === 'this-week') return e.match.week === latestReplayWeek;
        if (timeFilter === 'last-week') return e.match.week === Math.max(0, latestReplayWeek - 1);
        if (timeFilter === 'my-matches') {
          if (!user) return false;
          const myUserId = parseInt(user.id);
          return e.homeTeam?.userId === myUserId || e.awayTeam?.userId === myUserId;
        }
        return true;
      });
    }

    // Search
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
  }, [entries, search, leagueFilter, timeFilter, latestReplayWeek, user]);

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

  // Stats strip — total + by league
  const stats = useMemo(() => {
    const total = entries.length;
    const byLeague = new Map<string, number>();
    for (const e of entries) {
      byLeague.set(e.league.id, (byLeague.get(e.league.id) ?? 0) + 1);
    }
    const blowouts = entries.filter(e => {
      const margin = Math.abs((e.match.homeScore ?? 0) - (e.match.awayScore ?? 0));
      return margin >= 4;
    }).length;
    const sweeps = entries.filter(e => {
      const home = e.match.homeScore ?? 0;
      const away = e.match.awayScore ?? 0;
      return (home === 6 && away === 0) || (away === 6 && home === 0);
    }).length;
    return { total, byLeague, blowouts, sweeps };
  }, [entries]);

  function toggleLeagueFilter(id: string) {
    setLeagueFilter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyShareLink(matchId: string) {
    const url = `${window.location.origin}/replays?match=${encodeURIComponent(matchId)}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success('Replay link copied'),
      () => toast.error('Could not copy'),
    );
  }

  function handleViewReplay(entry: ReplayEntry | null) {
    setViewingReplay(entry);
    if (!entry) {
      // Closing the viewer — drop the ?match query param if present
      if (searchParams.has('match')) {
        const next = new URLSearchParams(searchParams);
        next.delete('match');
        setSearchParams(next, { replace: true });
      }
      setTheater(false);
    }
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
    <div className={cn('flex flex-col h-full', theater && 'fixed inset-0 z-40 bg-surface p-6')}>
      <div className="flex items-center justify-between mb-3 gap-4">
        <div className="flex items-baseline gap-4 min-w-0">
          <h1 className="font-mono text-xl font-bold uppercase tracking-widest shrink-0">
            <span className="text-neon">Replay</span>{' '}
            <span className="text-text-primary">Gallery</span>
          </h1>
          {!loading && stats.total > 0 && (
            <div className="flex items-center gap-3 text-[10px] font-mono text-text-muted shrink-0 truncate">
              <span><span className="text-text-secondary tabular-nums">{stats.total}</span> total</span>
              <span className="text-border-default">·</span>
              <span><span className="text-amber-400 tabular-nums">{stats.sweeps}</span> sweep{stats.sweeps !== 1 && 's'}</span>
              <span className="text-border-default">·</span>
              <span><span className="text-pink tabular-nums">{stats.blowouts}</span> blowout{stats.blowouts !== 1 && 's'}</span>
            </div>
          )}
        </div>

        {isAdmin && (
          <button
            onClick={() => navigate(`/replays/stream/${streamWeek}`)}
            title={`Open broadcast cockpit for week ${streamWeek}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neon/40 bg-neon/5 text-neon text-[11px] font-mono uppercase tracking-widest hover:bg-neon/10 transition-colors shrink-0"
          >
            <Radio size={14} />
            Start Week {streamWeek} Stream
          </button>
        )}
      </div>

      {/* Replay viewer panel */}
      {viewingReplay && (
        <div className={cn(
          'mb-4 rounded-lg border border-neon/20 bg-surface-raised overflow-hidden',
          theater && 'flex-1 flex flex-col mb-0',
        )}>
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
              <button
                onClick={() => copyShareLink(viewingReplay.match.id)}
                className="p-1 text-text-muted hover:text-neon transition-colors"
                title="Copy share link"
              >
                <Link2 size={13} />
              </button>
              <button
                onClick={() => setTheater(t => !t)}
                className="p-1 text-text-muted hover:text-neon transition-colors"
                title={theater ? 'Exit theater mode' : 'Theater mode'}
              >
                {theater ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
              {isLocalReplay(viewingReplay.match.replayUrl!) && (
                <a
                  href={viewingReplay.match.replayUrl!}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1 text-text-muted hover:text-neon transition-colors"
                  title="Open in new tab"
                >
                  <ExternalLink size={13} />
                </a>
              )}
              <button
                onClick={() => handleViewReplay(null)}
                className="p-1 text-text-muted hover:text-loss transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {isLocalReplay(viewingReplay.match.replayUrl!) ? (
            <iframe
              src={viewingReplay.match.replayUrl!}
              className={cn('w-full border-0 bg-white', theater ? 'flex-1' : '')}
              style={!theater ? { height: '500px' } : undefined}
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

      {/* Time filter chips + Search + League chips */}
      {!theater && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {TIME_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setTimeFilter(f.id)}
                disabled={f.id === 'my-matches' && !user}
                className={cn(
                  'text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                  timeFilter === f.id
                    ? 'border-neon/40 bg-neon/10 text-neon'
                    : 'border-border-default text-text-muted hover:text-text-secondary',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

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
        </>
      )}

      {/* Content */}
      {theater ? null : loading ? (
        <div className="text-text-muted text-sm py-12 text-center">Loading replays...</div>
      ) : entries.length === 0 ? (
        <EmptyState
          variant="coming-soon"
          title="No replays available yet."
          subtitle="Once matches are played, they'll show up here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="nothing-here"
          title="No replays match these filters."
          subtitle={timeFilter !== 'all' ? 'Try All-Time to see everything.' : undefined}
          spriteSize="md"
        />
      ) : (
        <div className="space-y-5 flex-1 overflow-y-auto">
          {grouped.map(([week, weekEntries]) => (
            <div key={week}>
              <h2 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-text-muted mb-2">
                Week {week}
              </h2>
              <div className="space-y-1">
                {weekEntries.map(({ match, league, homeTeam, awayTeam }, i) => {
                  const entry = { match, league, homeTeam, awayTeam };
                  const isViewing = viewingReplay?.match.id === match.id;
                  const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
                  const awayWon = (match.awayScore ?? 0) > (match.homeScore ?? 0);
                  const summary = summaries.get(match.id);
                  const mvpTeam = summary?.mvp
                    ? (summary.mvp.teamId === match.homePlayer ? homeTeam : awayTeam)
                    : undefined;
                  return (
                    <div
                      key={match.id}
                      className={cn(
                        'stagger-item row-interactive flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors',
                        isViewing
                          ? 'bg-neon/5 border-neon/20'
                          : 'bg-surface-raised border-border-default hover:border-border-default/80',
                      )}
                      style={{
                        ['--i' as never]: Math.min(i, 20),
                        ['--card-accent' as never]: league.color,
                      }}
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
                          className={cn(
                            'text-sm font-medium hover:text-neon transition-colors truncate',
                            homeWon ? 'text-win' : 'text-text-secondary',
                          )}
                        >
                          {homeTeam?.teamAbbrev ?? match.homePlayer}
                        </Link>

                        <span className="text-[11px] font-mono tabular-nums text-text-muted shrink-0">
                          <span className={homeWon ? 'text-win' : ''}>{match.homeScore}</span>
                          -
                          <span className={awayWon ? 'text-win' : ''}>{match.awayScore}</span>
                        </span>

                        <Link
                          to={`/league/${league.id}/teams/${awayTeam?.id}`}
                          className={cn(
                            'text-sm font-medium hover:text-neon transition-colors truncate',
                            awayWon ? 'text-win' : 'text-text-secondary',
                          )}
                        >
                          {awayTeam?.teamAbbrev ?? match.awayPlayer}
                        </Link>
                      </div>

                      {/* Replay-summary glance — MVP / sweep / tera-heavy */}
                      <ReplayRowGlance summary={summary} mvpTeamColor={mvpTeam?.teamColor} />

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleViewReplay(isViewing ? null : entry)}
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
                        <button
                          onClick={() => copyShareLink(match.id)}
                          className="text-text-muted hover:text-neon transition-colors p-1"
                          title="Copy share link"
                        >
                          <Link2 size={13} />
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
      {!loading && !theater && filtered.length > 0 && (
        <p className="text-[10px] text-text-muted mt-4">
          {filtered.length} replay{filtered.length !== 1 ? 's' : ''} found
        </p>
      )}
    </div>
  );
}

/**
 * Inline glance line for a replay row — surfaces the unused replay_summary
 * data the user has been sitting on: top K-getter as a sprite + name + kill
 * count (if any), tera count when ≥3 (mark as "tera-heavy"), and a sweep
 * pill when the score was 6-0. All optional; renders nothing if the summary
 * hasn't loaded or the match is uneventful.
 */
function ReplayRowGlance({
  summary,
  mvpTeamColor,
}: {
  summary: ApiReplaySummary | undefined;
  mvpTeamColor: string | undefined;
}) {
  if (!summary || !summary.isComplete) return null;

  const hasMvp = summary.mvp && summary.mvp.kills > 0;
  const teraHeavy = summary.teraCount >= 3;
  const sweep = summary.sweep;

  if (!hasMvp && !teraHeavy && !sweep) return null;

  return (
    <div className="hidden md:flex items-center gap-1.5 shrink-0 mr-1">
      {hasMvp && summary.mvp && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-subtle bg-surface-overlay/60"
              style={mvpTeamColor ? { borderColor: `${mvpTeamColor}40` } : undefined}
            >
              <Trophy size={10} className="text-amber-400 shrink-0" />
              <PokemonSprite name={summary.mvp.name} size="xs" className="!w-4 !h-4" />
              <span className="text-[10px] font-mono tabular-nums text-text-secondary">
                {summary.mvp.kills}K
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <span className="font-medium">{summary.mvp.name}</span>
            {' — '}
            <span className="text-win">{summary.mvp.kills}K</span>
            {' / '}
            <span className="text-loss">{summary.mvp.deaths}D</span>
            {' (MVP)'}
          </TooltipContent>
        </Tooltip>
      )}
      {sweep && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400">
          <Flame size={9} />
          Sweep
        </span>
      )}
      {teraHeavy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-pink/15 text-pink">
              <Zap size={9} />
              {summary.teraCount}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {summary.teraCount} teras used — tera-heavy game
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
