import { useState, useEffect, useMemo } from 'react';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { TeamLogo } from '@/components/team-logo';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type AvailStatus = 'available' | 'unavailable' | 'maybe';

interface AvailEntry {
  teamId: string;
  week: number;
  day: string;
  status: string;
  note: string | null;
}

const STATUS_STYLES: Record<AvailStatus, { bg: string; text: string; label: string }> = {
  available: { bg: 'bg-win/15 border-win/30', text: 'text-win', label: 'Available' },
  maybe: { bg: 'bg-draw/15 border-draw/30', text: 'text-draw', label: 'Maybe' },
  unavailable: { bg: 'bg-loss/15 border-loss/30', text: 'text-loss', label: 'Busy' },
};

const CYCLE: AvailStatus[] = ['available', 'maybe', 'unavailable'];

function getWeekDays(weekDate?: string): string[] {
  // Generate 7 days starting from the week date, or use current week
  const start = weekDate ? new Date(weekDate + 'T00:00:00') : getMonday(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function formatDay(iso: string): { short: string; date: string } {
  const d = new Date(iso + 'T00:00:00');
  return {
    short: d.toLocaleDateString('en-US', { weekday: 'short' }),
    date: d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
  };
}

interface AvailabilityPanelProps {
  selectedWeek: number;
}

export function AvailabilityPanel({ selectedWeek }: AvailabilityPanelProps) {
  const league = useLeague();
  const { players } = useLeagueData();
  const { isAdmin } = useAuth();
  const [entries, setEntries] = useState<AvailEntry[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  // Fetch availability data
  useEffect(() => {
    api.getAvailability(league.id).then(setEntries).catch(() => {});
  }, [league.id]);

  // Week days based on weekDates
  const weekDays = useMemo(() => {
    const dateStr = league.season?.weekDates?.[String(selectedWeek)];
    return getWeekDays(dateStr);
  }, [selectedWeek, league.season?.weekDates]);

  // Filter entries for this week
  const weekEntries = useMemo(
    () => entries.filter(e => e.week === selectedWeek),
    [entries, selectedWeek],
  );

  function getStatus(teamId: string, day: string): AvailStatus | null {
    const entry = weekEntries.find(e => e.teamId === teamId && e.day === day);
    return entry ? entry.status as AvailStatus : null;
  }

  async function cycleStatus(teamId: string, day: string) {
    const current = getStatus(teamId, day);
    const idx = current ? CYCLE.indexOf(current) : -1;
    const next = CYCLE[(idx + 1) % CYCLE.length];

    // Optimistic update
    setEntries(prev => {
      const filtered = prev.filter(e => !(e.teamId === teamId && e.week === selectedWeek && e.day === day));
      return [...filtered, { teamId, leagueId: league.id, week: selectedWeek, day, status: next, note: null }];
    });

    try {
      await api.setAvailability(league.id, { teamId, week: selectedWeek, day, status: next });
    } catch {
      toast.error('Failed to update availability');
      // Refetch
      api.getAvailability(league.id).then(setEntries).catch(() => {});
    }
  }

  // Determine which teams the user can edit
  const canEdit = isAdmin; // For now, admins can edit any team
  const isEmpty = weekEntries.length === 0;
  const [expanded, setExpanded] = useState(false);

  if (players.length === 0) return null;

  // Collapsed state for non-editors when no data exists
  if (isEmpty && !canEdit && !expanded) {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-raised/40 px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider">
            Week {selectedWeek} Availability
          </h3>
          <p className="text-[11px] text-text-muted mt-0.5">No availability submitted this week.</p>
        </div>
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
        >
          Show grid
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider">
          Week {selectedWeek} Availability
        </h3>
        {canEdit && (
          <select
            value={selectedTeam ?? ''}
            onChange={(e) => setSelectedTeam(e.target.value || null)}
            className="h-7 px-2 rounded border border-border-default bg-surface-overlay text-text-primary text-xs"
          >
            <option value="">Select team to edit...</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>{p.teamAbbrev} — {p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Grid */}
      <div className="rounded-lg border border-border-default overflow-hidden">
        {/* Header row — days */}
        <div className="grid bg-surface-overlay/50 border-b border-border-subtle" style={{ gridTemplateColumns: `100px repeat(${weekDays.length}, 1fr)` }}>
          <div className="px-2 py-1.5 text-[10px] text-text-muted font-medium">Team</div>
          {weekDays.map(day => {
            const { short, date } = formatDay(day);
            return (
              <div key={day} className="px-1 py-1.5 text-center">
                <div className="text-[10px] font-medium text-text-secondary">{short}</div>
                <div className="text-[9px] text-text-muted">{date}</div>
              </div>
            );
          })}
        </div>

        {/* Player rows */}
        {players.map(player => {
          const isEditable = canEdit && selectedTeam === player.id;
          return (
            <div
              key={player.id}
              className={cn(
                'grid border-b border-border-subtle last:border-0',
                isEditable && 'bg-neon/5',
              )}
              style={{ gridTemplateColumns: `100px repeat(${weekDays.length}, 1fr)` }}
            >
              <div className="px-2 py-1.5 flex items-center gap-1.5">
                <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
                <span className="text-[11px] text-text-secondary font-medium truncate">{player.teamAbbrev}</span>
              </div>
              {weekDays.map(day => {
                const status = getStatus(player.id, day);
                const style = status ? STATUS_STYLES[status] : null;
                return (
                  <div key={day} className="px-0.5 py-1 flex items-center justify-center">
                    {isEditable ? (
                      <button
                        onClick={() => cycleStatus(player.id, day)}
                        className={cn(
                          'w-full h-6 rounded text-[9px] font-semibold border transition-all',
                          style
                            ? `${style.bg} ${style.text}`
                            : 'border-border-subtle text-text-muted/40 hover:border-border-default hover:text-text-muted',
                        )}
                      >
                        {style?.label ?? '—'}
                      </button>
                    ) : (
                      <div className={cn(
                        'w-full h-6 rounded flex items-center justify-center text-[9px] font-semibold',
                        style ? `${style.bg} ${style.text} border` : '',
                      )}>
                        {style ? style.label : <span className="w-1 h-1 rounded-full bg-text-muted/15" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-text-muted">
        {canEdit
          ? 'Select a team above, then click cells to cycle: Available → Maybe → Busy'
          : 'Player availability for this week'}
      </p>
    </div>
  );
}
