import { useState, useEffect, useMemo } from 'react';
import { Radio } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ApiMatch, ApiReplaySummary } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';
import { toast } from 'sonner';
import type { ReplayEntry, TimeFilter } from './replays/replay-types';
import { isReplayWeekEnded } from './replays/replay-types';
import { ReplayViewerPanel } from './replays/replay-viewer-panel';
import { ReplayFilters } from './replays/replay-filters';
import { ReplayCard } from './replays/replay-card';
import { ReplayHeroCard } from './replays/replay-hero-card';

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
          api.getTeams(league.id).catch(() => []),
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

  // Open a specific replay if ?match=ID is in the URL — for share links and
  // deep-links from other pages (pokemon detail, profiles). Re-syncs whenever
  // the URL param changes so navigating from one match link to another while
  // already on the page swaps the open replay instead of sticking on the first.
  useEffect(() => {
    const matchId = searchParams.get('match');
    if (!matchId) return;
    if (entries.length === 0) return;
    if (viewingReplay?.match.id === matchId) return;
    const found = entries.find(e => e.match.id === matchId);
    if (found) {
      setViewingReplay(found);
      // Make sure the row is actually visible in the grid below the viewer —
      // otherwise an active filter could hide the deep-linked match entirely.
      setTimeFilter('all');
      setLeagueFilter(new Set());
      setSearch('');
    }
  }, [searchParams, entries, viewingReplay]);

  // Filter — sorted by week descending so the first item is "most recent"
  // (used as the hero card pick).
  const filtered = useMemo(() => {
    let result = entries;

    if (leagueFilter.size > 0) {
      result = result.filter(e => leagueFilter.has(e.league.id));
    }

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

    // Sort by week descending; tie-break on match id to keep order stable
    // and deterministic. The first entry feeds the hero card.
    return [...result].sort((a, b) => {
      if (b.match.week !== a.match.week) return b.match.week - a.match.week;
      return b.match.id.localeCompare(a.match.id);
    });
  }, [entries, search, leagueFilter, timeFilter, latestReplayWeek, user]);

  // Hero pick = most recent in the current filtered set (filtered[0] after
  // descending sort). Rest of the cards fill the grid.
  const heroEntry = filtered[0];
  const gridEntries = filtered.slice(1);

  // Stats — total + sweeps + blowouts. Lives inside the hero card now;
  // also reused as a fallback strip when no replays match the filters.
  const stats = useMemo(() => {
    const total = entries.length;
    // Categories are mutually exclusive: a sweep (6-0) is reported as a sweep,
    // and a blowout is a non-sweep margin >= 4 (6-1, 6-2). This keeps
    // total >= sweeps + blowouts and avoids double-counting a 6-0 in both.
    const sweeps = entries.filter(e => {
      const home = e.match.homeScore ?? 0;
      const away = e.match.awayScore ?? 0;
      return (home === 6 && away === 0) || (away === 6 && home === 0);
    }).length;
    const blowouts = entries.filter(e => {
      const home = e.match.homeScore ?? 0;
      const away = e.match.awayScore ?? 0;
      const isSweep = (home === 6 && away === 0) || (away === 6 && home === 0);
      const margin = Math.abs(home - away);
      return !isSweep && margin >= 4;
    }).length;
    return { total, sweeps, blowouts };
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

  return (
    <div className={cn('flex flex-col h-full', theater && 'fixed inset-0 z-40 bg-surface p-6')}>
      <div className="flex items-center justify-between mb-3 gap-4">
        <h1 className="font-mono text-xl font-bold uppercase tracking-widest shrink-0">
          <span className="text-neon">Replay</span>{' '}
          <span className="text-text-primary">Gallery</span>
        </h1>

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
        <ReplayViewerPanel
          entry={viewingReplay}
          theater={theater}
          onToggleTheater={() => setTheater(t => !t)}
          onCopyShareLink={copyShareLink}
          onClose={() => handleViewReplay(null)}
        />
      )}

      {/* Time filter chips + Search + League chips */}
      {!theater && (
        <ReplayFilters
          timeFilter={timeFilter}
          onTimeFilterChange={setTimeFilter}
          search={search}
          onSearchChange={setSearch}
          leagues={leagues}
          leagueFilter={leagueFilter}
          onToggleLeagueFilter={toggleLeagueFilter}
          hasUser={!!user}
        />
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
        <div className="flex-1 overflow-y-auto pr-1">
          {heroEntry && (
            <ReplayHeroCard
              entry={heroEntry}
              isViewing={viewingReplay?.match.id === heroEntry.match.id}
              summary={summaries.get(heroEntry.match.id)}
              stats={stats}
              weekEnded={isReplayWeekEnded(heroEntry)}
              onToggleViewing={handleViewReplay}
              onCopyShareLink={copyShareLink}
            />
          )}

          {gridEntries.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {gridEntries.map((entry, i) => (
                <ReplayCard
                  key={entry.match.id}
                  entry={entry}
                  index={i}
                  isViewing={viewingReplay?.match.id === entry.match.id}
                  summary={summaries.get(entry.match.id)}
                  weekEnded={isReplayWeekEnded(entry)}
                  onToggleViewing={handleViewReplay}
                />
              ))}
            </div>
          )}
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
