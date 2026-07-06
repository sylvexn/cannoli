import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, CheckCircle2, Swords, ChevronDown, ChevronUp, ChevronRight,
} from 'lucide-react';
import type { ApiAdminMatch, MatchWarning } from '@/lib/api';
import type { League } from '@/lib/types';
import type { TeamNameResolver } from '@/lib/use-team-names';
import { TeamLink } from '@/components/team-link';
import { ReplayLink } from '@/components/replay-link';
import { Spoiler } from '@/components/spoiler';
import {
  StatusBadge, WarningCountBadge, PhaseBadge, WeekSummary,
} from './match-status-badges';
import { MatchActionsDropdown } from './match-actions-dropdown';
import type { ResultMode } from './match-entry-dialog';

/**
 * Render a single match warning as text. Structured warnings carry
 * team/pokemon context; flattening them here keeps React from choking on a raw
 * object child (React error #31).
 */
function warningText(w: MatchWarning): string {
  if (typeof w === 'string') return w;
  const where = [w.team, w.pokemon].filter(Boolean).join(' ');
  return where ? `${where}: ${w.reason}` : w.reason;
}

interface MatchWeekSectionProps {
  week: number;
  matches: ApiAdminMatch[];
  open: boolean;
  leagueMap: Map<string, League>;
  teamNames: TeamNameResolver;
  expandedMatch: string | null;
  fmtDateTime: (iso: string) => string;
  onToggleWeek: (week: number) => void;
  onToggleMatch: (id: string) => void;
  onChanged: () => void;
  onEnterResult: (match: ApiAdminMatch, mode?: ResultMode) => void;
  onDismissWarnings: (matchId: string) => void;
}

export function MatchWeekSection({
  week,
  matches,
  open,
  leagueMap,
  teamNames,
  expandedMatch,
  fmtDateTime,
  onToggleWeek,
  onToggleMatch,
  onChanged,
  onEnterResult,
  onDismissWarnings,
}: MatchWeekSectionProps) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-1 pt-3 px-4">
        <button
          type="button"
          onClick={() => onToggleWeek(week)}
          className="flex w-full items-center gap-2 text-left outline-none"
        >
          {open
            ? <ChevronDown size={12} className="text-text-muted shrink-0" />
            : <ChevronRight size={12} className="text-text-muted shrink-0" />}
          <span className="text-[10px] font-mono font-bold text-text-muted uppercase tracking-widest">
            Week {week}
            <span className="text-text-muted/50 ml-2">({matches.length})</span>
          </span>
          <div className="flex-1" />
          <span className="text-[11px]">
            <WeekSummary matches={matches} />
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="p-0">
          <div className="divide-y divide-border-subtle">
            {matches.map(match => (
              <MatchRow
                key={match.id}
                match={match}
                league={leagueMap.get(match.leagueId)}
                teamNames={teamNames}
                expanded={expandedMatch === match.id}
                fmtDateTime={fmtDateTime}
                onToggleMatch={onToggleMatch}
                onChanged={onChanged}
                onEnterResult={onEnterResult}
                onDismissWarnings={onDismissWarnings}
              />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

interface MatchRowProps {
  match: ApiAdminMatch;
  league?: League;
  teamNames: TeamNameResolver;
  expanded: boolean;
  fmtDateTime: (iso: string) => string;
  onToggleMatch: (id: string) => void;
  onChanged: () => void;
  onEnterResult: (match: ApiAdminMatch, mode?: ResultMode) => void;
  onDismissWarnings: (matchId: string) => void;
}

function MatchRow({
  match,
  league,
  teamNames,
  expanded,
  fmtDateTime,
  onToggleMatch,
  onChanged,
  onEnterResult,
  onDismissWarnings,
}: MatchRowProps) {
  const hasWarnings = match.warnings.length > 0;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2.5 px-4 py-2 transition-colors cursor-pointer',
          'hover:bg-surface-overlay/50',
          hasWarnings && 'bg-loss/5',
        )}
        onClick={() => onToggleMatch(match.id)}
      >
        {league && (
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
        )}

        <div
          className="flex items-center gap-1.5 min-w-0"
          onClick={e => e.stopPropagation()}
        >
          <div className="min-w-0 flex-1 overflow-hidden">
            <AdminTeamChip teamId={match.homeTeamId} resolver={teamNames} />
          </div>
          <span className="text-[10px] text-text-muted shrink-0">vs</span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <AdminTeamChip teamId={match.awayTeamId} resolver={teamNames} />
          </div>
        </div>

        <div
          className="w-[60px] shrink-0 text-center"
          onClick={e => e.stopPropagation()}
        >
          {match.homeScore !== null ? (
            <Spoiler matchId={match.id} label="Score — click to reveal">
              <span className="text-xs font-mono font-medium text-text-primary">
                {match.homeScore} - {match.awayScore}
              </span>
            </Spoiler>
          ) : (
            <span className="text-[10px] text-text-muted">—</span>
          )}
        </div>

        <div className="shrink-0">
          <StatusBadge status={match.status} />
        </div>
        {hasWarnings && (
          <span className="hidden lg:flex shrink-0">
            <WarningCountBadge count={match.warnings.length} />
          </span>
        )}
        <span className="hidden lg:flex shrink-0">
          <PhaseBadge match={match} />
        </span>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          {(match.status === 'scheduled' || match.status === 'ready') && (
            <Button
              size="xs"
              variant="outline"
              className="text-neon border-neon/30 hover:bg-neon/10 h-6 text-[10px]"
              onClick={e => { e.stopPropagation(); onEnterResult(match); }}
            >
              Enter Result
            </Button>
          )}
          {hasWarnings && (
            <Button
              size="xs"
              variant="outline"
              className="text-draw border-draw/30 hover:bg-draw/10 h-6 text-[10px]"
              onClick={e => { e.stopPropagation(); onDismissWarnings(match.id); }}
            >
              Dismiss
            </Button>
          )}
          <MatchActionsDropdown
            match={match}
            teamNames={teamNames}
            onChanged={onChanged}
            onForceResult={(m) => onEnterResult(m, 'force')}
          />
        </div>

        {expanded
          ? <ChevronUp size={12} className="text-text-muted" />
          : <ChevronDown size={12} className="text-text-muted" />}
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-1 bg-surface-overlay/10 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-text-muted">
            <div>Match ID: <span className="text-text-secondary font-mono">{match.id}</span></div>
            <div>League: <span className="text-text-secondary">{league?.name ?? match.leagueId}</span></div>
            {match.psRoomId && <div>PS Room: <span className="text-text-secondary font-mono">{match.psRoomId}</span></div>}
            {match.startedAt && <div>Started: <span className="text-text-secondary">{fmtDateTime(match.startedAt)}</span></div>}
            {match.completedAt && <div>Completed: <span className="text-text-secondary">{fmtDateTime(match.completedAt)}</span></div>}
            {match.replayUrl ? (
              <div>
                Replay: <a href={match.replayUrl} target="_blank" rel="noopener" className="text-neon hover:underline">{match.replayUrl}</a>
              </div>
            ) : match.hasReplay ? (
              <div>
                Replay: <ReplayLink matchId={match.id} className="text-neon hover:underline">Watch in-site</ReplayLink>
              </div>
            ) : null}
          </div>

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
                onClick={() => onDismissWarnings(match.id)}
              >
                <CheckCircle2 size={12} />
                Approve & Dismiss
              </Button>
            </div>
          )}

          {match.homeScore === null && (
            <Button
              size="sm"
              variant="outline"
              className="text-neon border-neon/30 hover:bg-neon/10"
              onClick={() => onEnterResult(match)}
            >
              <Swords size={12} />
              Enter Match Result
            </Button>
          )}
        </div>
      )}
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
  resolver: TeamNameResolver;
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
