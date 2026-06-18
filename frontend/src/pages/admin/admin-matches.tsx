import { useState, useEffect, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { LoadingSprite } from '@/components/loading-sprite';
import { api } from '@/lib/api';
import type { ApiAdminMatch } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { useTeamNames } from '@/lib/use-team-names';
import { useFormatDateTime } from '@/lib/format';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { matchNeedsAttention, matchIsSettled } from './matches/match-status-badges';
import { MatchEntryDialog, type ResultMode } from './matches/match-entry-dialog';
import { MatchFilterBar, type MatchFilters, type PhaseFilter } from './matches/match-filter-bar';
import { MatchWeekSection } from './matches/match-week-section';
import { getErrorMessage } from '@/lib/errors';

export function AdminMatches() {
  const { leagues } = useAppData();
  const teamNames = useTeamNames();
  const fmtDateTime = useFormatDateTime();

  const [matches, setMatches] = useState<ApiAdminMatch[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters — league is a server param; everything else is client-side.
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

  // Fetch matches once per league change — status/phase/week/search all filter
  // client-side for instant response. League meaningfully shrinks the payload.
  const fetchMatches = useCallback(() => {
    setLoading(true);
    api.getAdminMatches({
      leagueId: leagueFilter !== 'all' ? leagueFilter : undefined,
    }).then(data => {
      setMatches(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leagueFilter]);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  const leagueMap = useMemo(() => new Map(leagues.map(l => [l.id, l])), [leagues]);

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
    const sig = `${leagueFilter}:${matches.length}`;
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
  }, [loading, matches, leagueFilter, leagueMap, autoExpandedFor]);

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
    leagueFilter, statusFilter, phaseFilter, weekFilter, teamSearch, attentionOnly,
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
      </div>

      {/* Filters */}
      <MatchFilterBar
        filters={filters}
        leagues={leagues}
        weeks={weeks}
        isFiltered={isFiltered}
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
