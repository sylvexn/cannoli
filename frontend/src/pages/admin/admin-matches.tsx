import { useState, useEffect, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { LoadingSprite } from '@/components/loading-sprite';
import { api } from '@/lib/api';
import type { ApiAdminMatch } from '@/lib/api';
import { mapLeagues } from '@/lib/app-data-context';
import type { League } from '@/lib/types';
import { useTeamNames } from '@/lib/use-team-names';
import { useFormatDateTime } from '@/lib/format';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import { SpoilerToggle } from '@/components/spoiler-toggle';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { matchNeedsAttention, matchIsSettled } from './matches/match-status-badges';
import { MatchEntryDialog, type ResultMode } from './matches/match-entry-dialog';
import { MatchFilterBar, type MatchFilters, type PhaseFilter, type SeasonOpt } from './matches/match-filter-bar';
import { MatchWeekSection } from './matches/match-week-section';
import { getErrorMessage } from '@/lib/errors';

export function AdminMatches() {
  const teamNames = useTeamNames();
  const fmtDateTime = useFormatDateTime();

  // All-season leagues (not just the active season) so matches from archived
  // seasons resolve their league/season and the season filter can list them.
  // null = not yet loaded (gates the first fetch until the default season is set).
  const [allLeagues, setAllLeagues] = useState<League[] | null>(null);
  useEffect(() => {
    api.getLeagues(true).then(a => setAllLeagues(mapLeagues(a))).catch(() => setAllLeagues([]));
  }, []);
  const leagues = useMemo(() => allLeagues ?? [], [allLeagues]);
  // Real league rows only — PS bot-invite battles spawn throwaway "leagues"
  // (botinvite-*) that shouldn't appear in the season/league pickers.
  const realLeagues = useMemo(() => leagues.filter(l => !l.id.startsWith('botinvite-')), [leagues]);

  // Seasons (desc) for the season axis; default the view to the active one.
  const seasons = useMemo<SeasonOpt[]>(() => {
    const m = new Map<string, SeasonOpt>();
    for (const l of realLeagues) {
      const s = l.season;
      if (!s || s.seasonNumber === 0) continue;
      if (!m.has(s.id)) m.set(s.id, { id: s.id, seasonNumber: s.seasonNumber, archived: !!s.archived });
    }
    return [...m.values()].sort((a, b) => b.seasonNumber - a.seasonNumber);
  }, [realLeagues]);
  const activeSeasonId = useMemo(() => {
    const active = seasons.find(s => !s.archived);
    return active?.id ?? seasons[0]?.id ?? 'all';
  }, [seasons]);

  const [matches, setMatches] = useState<ApiAdminMatch[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters — season + league are server params; everything else is client-side.
  const [seasonFilter, setSeasonFilter] = useState('');
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [weekFilter, setWeekFilter] = useState('all');
  const [teamSearch, setTeamSearch] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);

  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  // Tracks whether default expand has been applied for the current dataset so a
  // manual collapse/expand isn't clobbered on every re-render.
  const [autoExpandedFor, setAutoExpandedFor] = useState<string>('');

  // Result entry dialog (covers both fresh entry and admin force-result)
  const [resultOpen, setResultOpen] = useState(false);
  const [resultMatch, setResultMatch] = useState<ApiAdminMatch | null>(null);
  const [resultMode, setResultMode] = useState<ResultMode>('enter');

  // Default the season scope to the active season once leagues load.
  useEffect(() => {
    if (allLeagues !== null && !seasonFilter) setSeasonFilter(activeSeasonId);
  }, [allLeagues, activeSeasonId, seasonFilter]);

  // Fetch matches per season/league change — status/phase/week/search all
  // filter client-side for instant response. Season/league shrink the payload
  // server-side. Wait for the default season before the first fetch.
  const fetchMatches = useCallback(() => {
    if (!seasonFilter) return;
    setLoading(true);
    api.getAdminMatches({
      leagueId: leagueFilter !== 'all' ? leagueFilter : undefined,
      seasonId: seasonFilter !== 'all' ? seasonFilter : undefined,
    }).then(data => {
      setMatches(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leagueFilter, seasonFilter]);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  // Changing season resets the league filter so a stale league from another
  // season doesn't linger.
  const onSeasonChange = useCallback((v: string) => {
    setSeasonFilter(v);
    setLeagueFilter('all');
  }, []);

  const leagueMap = useMemo(() => new Map(leagues.map(l => [l.id, l])), [leagues]);

  // Leagues for the dropdown are scoped to the selected season.
  const leaguesForSeason = useMemo(
    () => (seasonFilter && seasonFilter !== 'all'
      ? realLeagues.filter(l => l.season?.id === seasonFilter)
      : realLeagues),
    [realLeagues, seasonFilter],
  );

  // Distinct weeks present in the league-filtered data (ascending) — drives the
  // week select.
  const weeks = useMemo(() => {
    const set = new Set<number>();
    for (const m of matches) set.add(m.week);
    return [...set].sort((a, b) => a - b);
  }, [matches]);

  // Apply all client-side filters.
  const filtered = useMemo(() => {
    const search = teamSearch.trim().toLowerCase();
    return matches.filter(m => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (phaseFilter !== 'all' && m.phase !== phaseFilter) return false;
      if (weekFilter !== 'all' && m.week !== Number(weekFilter)) return false;
      if (attentionOnly && !matchNeedsAttention(m)) return false;
      if (search) {
        const home = teamNames.name(m.homeTeamId).toLowerCase();
        const away = teamNames.name(m.awayTeamId).toLowerCase();
        const hit =
          home.includes(search) || away.includes(search) ||
          m.homeTeamId.toLowerCase().includes(search) ||
          m.awayTeamId.toLowerCase().includes(search);
        if (!hit) return false;
      }
      return true;
    });
  }, [matches, statusFilter, phaseFilter, weekFilter, teamSearch, attentionOnly, teamNames]);

  // Group filtered matches by week, ascending (1 -> N).
  const matchesByWeek = useMemo(() => {
    const groups = new Map<number, ApiAdminMatch[]>();
    for (const m of filtered) {
      const existing = groups.get(m.week) ?? [];
      existing.push(m);
      groups.set(m.week, existing);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  // Default expand logic: any week with an attention/non-settled match opens;
  // the selected league's current week opens; fully-settled past weeks collapse.
  // Recomputed when the league fetch produces a new dataset, not on every filter.
  useEffect(() => {
    if (loading) return;
    const sig = `${seasonFilter}:${leagueFilter}:${matches.length}`;
    if (sig === autoExpandedFor) return;

    const currentWeek = leagueFilter !== 'all'
      ? leagueMap.get(leagueFilter)?.season.currentWeek
      : undefined;

    const next = new Set<number>();
    const byWeek = new Map<number, ApiAdminMatch[]>();
    for (const m of matches) {
      const arr = byWeek.get(m.week) ?? [];
      arr.push(m);
      byWeek.set(m.week, arr);
    }
    for (const [week, ms] of byWeek) {
      const hasOutstanding = ms.some(m => !matchIsSettled(m));
      if (hasOutstanding || week === currentWeek) next.add(week);
    }
    setExpandedWeeks(next);
    setAutoExpandedFor(sig);
  }, [loading, matches, seasonFilter, leagueFilter, leagueMap, autoExpandedFor]);

  // When "Needs attention" is toggled on, expand every shown week so the items
  // are immediately visible.
  useEffect(() => {
    if (!attentionOnly) return;
    setExpandedWeeks(new Set(matchesByWeek.map(([w]) => w)));
  }, [attentionOnly, matchesByWeek]);

  const toggleWeek = useCallback((week: number) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(week)) next.delete(week); else next.add(week);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedWeeks(new Set(matchesByWeek.map(([w]) => w)));
  }, [matchesByWeek]);

  const collapseAll = useCallback(() => setExpandedWeeks(new Set()), []);

  // Stats over the filtered set.
  const stats = useMemo(() => {
    const completed = filtered.filter(m => m.status === 'completed').length;
    const disputed = filtered.filter(m => m.status === 'disputed').length;
    const warnings = filtered.filter(m => m.warnings.length > 0).length;
    const pending = filtered.filter(
      m => (m.status === 'scheduled' || m.status === 'ready') && m.homeScore === null,
    ).length;
    return { completed, disputed, warnings, pending };
  }, [filtered]);

  const isFiltered =
    statusFilter !== 'all' || phaseFilter !== 'all' || weekFilter !== 'all' ||
    teamSearch.trim() !== '' || attentionOnly;

  function clearFilters() {
    setStatusFilter('all');
    setPhaseFilter('all');
    setWeekFilter('all');
    setTeamSearch('');
    setAttentionOnly(false);
  }

  function openResultEntry(match: ApiAdminMatch, mode: ResultMode = 'enter') {
    setResultMatch(match);
    setResultMode(mode);
    setResultOpen(true);
  }

  async function handleDismissWarnings(matchId: string) {
    try {
      await api.dismissMatchWarnings(matchId);
      toast.success('Warnings dismissed');
      fetchMatches();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  }

  const filters: MatchFilters = {
    seasonFilter, leagueFilter, statusFilter, phaseFilter, weekFilter, teamSearch, attentionOnly,
  };

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total:</span>
          <span className="text-text-primary font-mono font-medium">
            {isFiltered ? `${filtered.length} of ${matches.length}` : matches.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={12} className="text-win" />
          <span className="text-text-primary font-mono">{stats.completed}</span>
        </div>
        {stats.pending > 0 && (
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-text-muted" />
            <span className="text-text-muted font-mono">{stats.pending} pending</span>
          </div>
        )}
        {stats.disputed > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-loss" />
            <span className="text-loss font-mono">{stats.disputed} disputed</span>
          </div>
        )}
        {stats.warnings > 0 && (
          <Badge variant="outline" className="text-draw border-draw/30 bg-draw/10 text-[10px]">
            <AlertTriangle size={10} />
            {stats.warnings} with warnings
          </Badge>
        )}
        <div className="flex-1" />
        <SpoilerToggle />
      </div>

      {/* Filters */}
      <MatchFilterBar
        filters={filters}
        seasons={seasons}
        leagues={leaguesForSeason}
        weeks={weeks}
        isFiltered={isFiltered}
        onSeasonChange={onSeasonChange}
        onLeagueChange={setLeagueFilter}
        onStatusChange={setStatusFilter}
        onPhaseChange={setPhaseFilter}
        onWeekChange={setWeekFilter}
        onTeamSearchChange={setTeamSearch}
        onAttentionToggle={() => setAttentionOnly(v => !v)}
        onClear={clearFilters}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />

      {/* Match list by week */}
      {loading ? (
        <LoadingSprite label="Loading matches..." />
      ) : matchesByWeek.length === 0 ? (
        <EmptyState
          variant="nothing-here"
          title={isFiltered ? 'No matches match these filters.' : 'No matches found.'}
          spriteSize="md"
        />
      ) : (
        <div className="space-y-3">
          {matchesByWeek.map(([week, weekMatches]) => (
            <MatchWeekSection
              key={week}
              week={week}
              matches={weekMatches}
              open={expandedWeeks.has(week)}
              leagueMap={leagueMap}
              teamNames={teamNames}
              expandedMatch={expandedMatch}
              fmtDateTime={fmtDateTime}
              onToggleWeek={toggleWeek}
              onToggleMatch={(id) => setExpandedMatch(prev => prev === id ? null : id)}
              onChanged={fetchMatches}
              onEnterResult={openResultEntry}
              onDismissWarnings={handleDismissWarnings}
            />
          ))}
        </div>
      )}

      {/* Result Entry Dialog (also handles admin force-result for completed matches) */}
      <MatchEntryDialog
        match={resultMatch}
        mode={resultMode}
        teamNames={teamNames}
        open={resultOpen}
        onOpenChange={setResultOpen}
        onSaved={fetchMatches}
      />
    </div>
  );
}
