/**
 * Read-only week-at-a-glance availability grid for the schedule page. Each
 * row is a team in the league; each column is a day Mon-Sun for the
 * selected week. Cells render a colored bar tinted by status (available /
 * maybe / busy) so coordinators can eyeball when most teams overlap.
 *
 * Editing was moved to /settings (Availability tab) — owners go there to
 * set their own availability; staff still have the per-team edit flow on
 * the admin teams surface. This component intentionally has no write path.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { api } from '@/lib/api';
import { TeamLogo } from '@/components/team-logo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type AvailStatus = 'available' | 'unavailable' | 'maybe';

interface AvailEntry {
  teamId: string;
  week: number;
  day: string;
  status: string;
  note: string | null;
}

const STATUS_STYLES: Record<AvailStatus, { bar: string; label: string; dot: string }> = {
  available: { bar: 'bg-win/70',  label: 'Available', dot: 'bg-win' },
  maybe:     { bar: 'bg-draw/70', label: 'Maybe',     dot: 'bg-draw' },
  unavailable: { bar: 'bg-loss/70', label: 'Busy',    dot: 'bg-loss' },
};

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekDays(weekDate?: string): string[] {
  const start = weekDate ? new Date(weekDate + 'T00:00:00') : getMonday(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function formatDay(iso: string): { short: string; date: string } {
  const d = new Date(iso + 'T00:00:00');
  return {
    short: d.toLocaleDateString('en-US', { weekday: 'short' }),
    date: d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
  };
}

interface AvailabilityAggregateProps {
  selectedWeek: number;
}

export function AvailabilityAggregate({ selectedWeek }: AvailabilityAggregateProps) {
  const league = useLeague();
  const { players } = useLeagueData();
  const [entries, setEntries] = useState<AvailEntry[]>([]);

  useEffect(() => {
    api.getAvailability(league.id).then(setEntries).catch(() => setEntries([]));
  }, [league.id]);

  const weekDays = useMemo(() => {
    const dateStr = league.season?.weekDates?.[String(selectedWeek)];
    return getWeekDays(dateStr);
  }, [selectedWeek, league.season?.weekDates]);

  const weekEntries = useMemo(
    () => entries.filter(e => e.week === selectedWeek),
    [entries, selectedWeek],
  );

  // Per-day overlap counts for the summary bar at the top.
  const overlapCounts = useMemo(() => weekDays.map(day => {
    const a = weekEntries.filter(e => e.day === day && e.status === 'available').length;
    const m = weekEntries.filter(e => e.day === day && e.status === 'maybe').length;
    const b = weekEntries.filter(e => e.day === day && e.status === 'unavailable').length;
    return { day, available: a, maybe: m, busy: b };
  }), [weekDays, weekEntries]);

  function getEntry(teamId: string, day: string): AvailEntry | null {
    return weekEntries.find(e => e.teamId === teamId && e.day === day) ?? null;
  }

  if (players.length === 0) return null;

  const totalTeams = players.length;
  const isEmpty = weekEntries.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider">
          Week {selectedWeek} Availability
        </h3>
        <span className="text-[10px] text-text-muted">
          Edit yours in <span className="font-mono">/settings → Availability</span>
        </span>
      </div>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-border-subtle px-4 py-3 text-[11px] text-text-muted">
          No availability submitted for this week yet.
        </div>
      ) : (
        <div className="rounded-lg border border-border-default overflow-hidden">
          {/* Header: day labels + total-available counts */}
          <div
            className="grid bg-surface-overlay/50 border-b border-border-subtle"
            style={{ gridTemplateColumns: `120px repeat(${weekDays.length}, 1fr)` }}
          >
            <div className="px-2 py-1.5 text-[10px] text-text-muted font-medium">Team</div>
            {overlapCounts.map(({ day, available }) => {
              const { short, date } = formatDay(day);
              return (
                <div key={day} className="px-1 py-1.5 text-center">
                  <div className="text-[10px] font-medium text-text-secondary">{short}</div>
                  <div className="text-[9px] text-text-muted tabular-nums">{date}</div>
                  <div className="mt-0.5 text-[9px] tabular-nums text-win">
                    {available}/{totalTeams}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Team rows */}
          {players.map(player => (
            <div
              key={player.id}
              className="grid border-b border-border-subtle last:border-0"
              style={{ gridTemplateColumns: `120px repeat(${weekDays.length}, 1fr)` }}
            >
              <div className="px-2 py-1.5 flex items-center gap-1.5">
                <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" logoPath={player.logoPath} />
                <span className="text-[11px] text-text-secondary font-medium truncate">{player.teamAbbrev}</span>
              </div>
              {weekDays.map(day => {
                const entry = getEntry(player.id, day);
                const status = entry ? entry.status as AvailStatus : null;
                const style = status ? STATUS_STYLES[status] : null;
                return (
                  <div key={day} className="px-1 py-1.5 flex items-center justify-center">
                    {style ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className={cn('w-full h-3 rounded-sm cursor-default', style.bar)} aria-label={style.label} />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="px-2 py-1">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className={cn('w-1.5 h-1.5 rounded-full', style.dot)} />
                            <span>{style.label}</span>
                          </div>
                          {entry?.note && (
                            <div className="text-[10px] text-text-muted mt-0.5 max-w-[180px] whitespace-pre-line">
                              {entry.note}
                            </div>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="w-1 h-1 rounded-full bg-text-muted/15" aria-label="No availability set" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
