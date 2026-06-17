import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSprite } from '@/components/loading-sprite';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import type { ApiAdminMatch, MatchWarning } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { useTeamNames } from '@/lib/use-team-names';
import { TeamLink } from '@/components/team-link';
import { useFormatDateTime } from '@/lib/format';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';
import {
  AlertTriangle, CheckCircle2, Swords,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  STATUS_CONFIG, StatusBadge, WarningCountBadge, PhaseBadge,
} from './matches/match-status-badges';
import { MatchEntryDialog, type ResultMode } from './matches/match-entry-dialog';
import { MatchActionsDropdown } from './matches/match-actions-dropdown';
import { getErrorMessage } from '@/lib/errors';

/**
 * Render a single match warning as text. Structured warnings (from the bot /
 * replay-import path) carry team/pokemon context; flattening them here keeps
 * React from choking on a raw object child (React error #31).
 */
function warningText(w: MatchWarning): string {
  if (typeof w === 'string') return w;
  const where = [w.team, w.pokemon].filter(Boolean).join(' ');
  return where ? `${where}: ${w.reason}` : w.reason;
}

export function AdminMatches() {
  const { leagues } = useAppData();
  const teamNames = useTeamNames();
  const fmtDateTime = useFormatDateTime();
  const [matches, setMatches] = useState<ApiAdminMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);

  // Result entry dialog (covers both fresh entry and admin force-result)
  const [resultOpen, setResultOpen] = useState(false);
  const [resultMatch, setResultMatch] = useState<ApiAdminMatch | null>(null);
  const [resultMode, setResultMode] = useState<ResultMode>('enter');

  function fetchMatches() {
    setLoading(true);
    api.getAdminMatches({
      leagueId: leagueFilter !== 'all' ? leagueFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    }).then(data => {
      setMatches(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchMatches(); }, [leagueFilter, statusFilter]);

  // Group by week
  const matchesByWeek = useMemo(() => {
    const groups = new Map<number, ApiAdminMatch[]>();
    for (const m of matches) {
      const existing = groups.get(m.week) ?? [];
      existing.push(m);
      groups.set(m.week, existing);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [matches]);

  // Counts
  const warningCount = matches.filter(m => m.warnings.length > 0).length;
  const disputedCount = matches.filter(m => m.status === 'disputed').length;
  const completedCount = matches.filter(m => m.status === 'completed').length;

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

  const leagueMap = useMemo(() => new Map(leagues.map(l => [l.id, l])), [leagues]);

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total:</span>
          <span className="text-text-primary font-mono font-medium">{matches.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={12} className="text-win" />
          <span className="text-text-primary font-mono">{completedCount}</span>
        </div>
        {disputedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-loss" />
            <span className="text-loss font-mono">{disputedCount} disputed</span>
          </div>
        )}
        {warningCount > 0 && (
          <Badge variant="outline" className="text-draw border-draw/30 bg-draw/10 text-[10px]">
            <AlertTriangle size={10} />
            {warningCount} with warnings
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={leagueFilter} onValueChange={(v) => setLeagueFilter(v ?? 'all')}>
          <SelectTrigger className="w-[160px] h-8 text-xs bg-surface-overlay">
            <SelectValue placeholder="All Leagues" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Leagues</SelectItem>
            {leagues.map(l => (
              <SelectItem key={l.id} value={l.id} className="text-xs">
                <span className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.name.replace(' League', '')}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
          <SelectTrigger className="w-[140px] h-8 text-xs bg-surface-overlay">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key} className="text-xs">{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Match list by week */}
      {loading ? (
        <LoadingSprite label="Loading matches..." />
      ) : matchesByWeek.length === 0 ? (
        <EmptyState
          variant="nothing-here"
          title="No matches found."
          spriteSize="md"
        />
      ) : (
        <div className="space-y-3">
          {matchesByWeek.map(([week, weekMatches]) => (
            <Card key={week} className="bg-surface-raised border-border-default">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-[10px] font-mono font-bold text-text-muted uppercase tracking-widest">
                  Week {week}
                  <span className="text-text-muted/50 ml-2">({weekMatches.length} matches)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border-subtle/20">
                  {weekMatches.map(match => {
                    const league = leagueMap.get(match.leagueId);
                    const hasWarnings = match.warnings.length > 0;
                    const isExpanded = expandedMatch === match.id;

                    return (
                      <div key={match.id}>
                        <div
                          className={cn(
                            'flex items-center gap-2.5 px-4 py-2 transition-colors cursor-pointer',
                            'hover:bg-surface-overlay/20',
                            hasWarnings && 'bg-loss/5',
                          )}
                          onClick={() => setExpandedMatch(isExpanded ? null : match.id)}
                        >
                          {/* League dot */}
                          {league && (
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
                          )}

                          {/* Teams */}
                          <div
                            className="flex items-center gap-1.5 min-w-[220px]"
                            onClick={e => e.stopPropagation()}
                          >
                            <AdminTeamChip teamId={match.homeTeamId} resolver={teamNames} />
                            <span className="text-[10px] text-text-muted">vs</span>
                            <AdminTeamChip teamId={match.awayTeamId} resolver={teamNames} />
                          </div>

                          {/* Score */}
                          <div className="w-[60px] text-center">
                            {match.homeScore !== null ? (
                              <span className="text-xs font-mono font-medium text-text-primary">
                                {match.homeScore} - {match.awayScore}
                              </span>
                            ) : (
                              <span className="text-[10px] text-text-muted">—</span>
                            )}
                          </div>

                          {/* Status */}
                          <StatusBadge status={match.status} />

                          {/* Warning indicator */}
                          {hasWarnings && <WarningCountBadge count={match.warnings.length} />}

                          {/* Phase badge */}
                          <PhaseBadge match={match} />

                          <div className="flex-1" />

                          {/* Actions */}
                          <div className="flex items-center gap-1">
                            {(match.status === 'scheduled' || match.status === 'ready') && (
                              <Button
                                size="xs"
                                variant="outline"
                                className="text-neon border-neon/30 hover:bg-neon/10 h-6 text-[10px]"
                                onClick={e => { e.stopPropagation(); openResultEntry(match); }}
                              >
                                Enter Result
                              </Button>
                            )}
                            {hasWarnings && (
                              <Button
                                size="xs"
                                variant="outline"
                                className="text-draw border-draw/30 hover:bg-draw/10 h-6 text-[10px]"
                                onClick={e => { e.stopPropagation(); handleDismissWarnings(match.id); }}
                              >
                                Dismiss
                              </Button>
                            )}
                            <MatchActionsDropdown
                              match={match}
                              teamNames={teamNames}
                              onChanged={fetchMatches}
                              onForceResult={(m) => openResultEntry(m, 'force')}
                            />
                          </div>

                          {isExpanded ? <ChevronUp size={12} className="text-text-muted" /> : <ChevronDown size={12} className="text-text-muted" />}
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-4 pb-3 pt-1 bg-surface-overlay/10 space-y-2 text-xs">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-text-muted">
                              <div>Match ID: <span className="text-text-secondary font-mono">{match.id}</span></div>
                              <div>League: <span className="text-text-secondary">{league?.name ?? match.leagueId}</span></div>
                              {match.psRoomId && <div>PS Room: <span className="text-text-secondary font-mono">{match.psRoomId}</span></div>}
                              {match.startedAt && <div>Started: <span className="text-text-secondary">{fmtDateTime(match.startedAt)}</span></div>}
                              {match.completedAt && <div>Completed: <span className="text-text-secondary">{fmtDateTime(match.completedAt)}</span></div>}
                              {match.replayUrl && (
                                <div>
                                  Replay: <a href={match.replayUrl} target="_blank" rel="noopener" className="text-neon hover:underline">{match.replayUrl}</a>
                                </div>
                              )}
                            </div>

                            {/* Warnings */}
                            {hasWarnings && (
                              <div className="space-y-1 rounded-md border border-draw/20 bg-draw/5 p-2">
                                <div className="flex items-center gap-1.5 text-draw font-medium">
                                  <AlertTriangle size={12} />
                                  Validation Warnings
                                </div>
                                <ul className="space-y-0.5 pl-5 list-disc text-text-secondary">
                                  {match.warnings.map((w, i) => (
                                    <li key={i}>{warningText(w)}</li>
                                  ))}
                                </ul>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="text-draw border-draw/30 hover:bg-draw/10 mt-1"
                                  onClick={() => handleDismissWarnings(match.id)}
                                >
                                  <CheckCircle2 size={12} />
                                  Approve & Dismiss
                                </Button>
                              </div>
                            )}

                            {/* Quick result entry for completed matches */}
                            {match.homeScore === null && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-neon border-neon/30 hover:bg-neon/10"
                                onClick={() => openResultEntry(match)}
                              >
                                <Swords size={12} />
                                Enter Match Result
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
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

/** Renders a clickable team chip for an admin match row, resolving the raw
 *  team ID to a name. Falls back to the raw ID while teams are still loading. */
function AdminTeamChip({
  teamId,
  resolver,
}: {
  teamId: string;
  resolver: ReturnType<typeof useTeamNames>;
}) {
  const team = resolver.get(teamId);
  if (!team) {
    return <span className="text-xs font-mono text-text-secondary truncate">{teamId}</span>;
  }
  return (
    <TeamLink
      team={{
        leagueId: team.leagueId,
        teamId: team.id,
        teamName: team.name,
        teamAbbrev: team.abbrev,
        teamColor: team.color,
      }}
      showLogo={false}
      size="xs"
    >
      <span className="text-xs truncate" style={{ color: team.color }}>{team.name}</span>
    </TeamLink>
  );
}
