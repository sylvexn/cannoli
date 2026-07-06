/**
 * Personal availability editor — moved out of the schedule page (where it
 * was previously inline as `<AvailabilityPanel />`) so the schedule surface
 * can host a read-only aggregated view instead of a single-team editor.
 *
 * The owner picks which league/week they're editing (most users own a team
 * in only one league, so the league dropdown auto-selects the only option).
 * Cells cycle Available → Maybe → Busy on click. Notes are not edited here
 * (the cycle UX would conflict); add the note via the API when needed.
 *
 * Staff editing other users' availability still happens league-side via the
 * existing schedule editor — this tab is owner-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarRange, Check, CircleHelp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getWeekDays, formatWeekDay, weekHasDates } from '@/lib/schedule-utils';

type AvailStatus = 'available' | 'unavailable' | 'maybe';

interface AvailEntry {
  teamId: string;
  leagueId?: string;
  week: number;
  day: string;
  status: string;
  note: string | null;
}

interface MyTeam {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  teamId: string;
  teamAbbrev: string;
  teamName: string;
  currentWeek: number;
  totalWeeks: number;
  weekDates: Record<string, string> | null | undefined;
}

const STATUS_STYLES: Record<AvailStatus, { bg: string; text: string; label: string; icon: typeof Check }> = {
  available: { bg: 'bg-win/15 border-win/30', text: 'text-win', label: 'Available', icon: Check },
  maybe: { bg: 'bg-draw/15 border-draw/30', text: 'text-draw', label: 'Maybe', icon: CircleHelp },
  unavailable: { bg: 'bg-loss/15 border-loss/30', text: 'text-loss', label: 'Busy', icon: X },
};

const CYCLE: AvailStatus[] = ['available', 'maybe', 'unavailable'];

export function AvailabilityTab() {
  const { user } = useAuth();
  const { leagues } = useAppData();
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [entries, setEntries] = useState<AvailEntry[]>([]);

  // Resolve the user's owned teams across every league. We gate everything
  // else (week list, fetch) on this being populated.
  useEffect(() => {
    if (!user || leagues.length === 0) {
      setMyTeams([]); setLoading(false); return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const lists = await Promise.all(leagues.map(l => api.getTeams(l.id).catch(() => [])));
      if (cancelled) return;
      const found: MyTeam[] = [];
      for (let i = 0; i < leagues.length; i++) {
        const league = leagues[i];
        if (!league) continue;
        const team = lists[i]?.find(t => t.userId != null && String(t.userId) === user.id);
        if (team) {
          found.push({
            leagueId: league.id,
            leagueName: league.name,
            leagueColor: league.color,
            teamId: team.id,
            teamAbbrev: team.teamAbbrev,
            teamName: team.teamName,
            currentWeek: league.season.currentWeek,
            totalWeeks: league.season.totalWeeks,
            weekDates: league.season.weekDates,
          });
        }
      }
      setMyTeams(found);
      setLoading(false);
      if (found.length > 0 && !activeLeagueId) {
        const first = found[0]!;
        setActiveLeagueId(first.leagueId);
        setSelectedWeek(first.currentWeek || 1);
      }
    })();
    return () => { cancelled = true; };
  }, [user, leagues, activeLeagueId]);

  const activeTeam = useMemo(
    () => myTeams.find(t => t.leagueId === activeLeagueId) ?? null,
    [myTeams, activeLeagueId],
  );

  // Refetch availability when the active league changes.
  useEffect(() => {
    if (!activeTeam) return;
    api.getAvailability(activeTeam.leagueId).then(setEntries).catch(() => setEntries([]));
  }, [activeTeam]);

  const weekDays = useMemo(() => {
    if (!activeTeam || selectedWeek == null) return [];
    return getWeekDays(activeTeam.weekDates, selectedWeek);
  }, [activeTeam, selectedWeek]);

  const hasDates = useMemo(
    () => activeTeam != null && selectedWeek != null && weekHasDates(activeTeam.weekDates, selectedWeek),
    [activeTeam, selectedWeek],
  );

  function getStatus(dayKey: string): AvailStatus | null {
    if (!activeTeam || selectedWeek == null) return null;
    const entry = entries.find(e => e.teamId === activeTeam.teamId && e.week === selectedWeek && e.day === dayKey);
    return entry ? entry.status as AvailStatus : null;
  }

  async function cycleStatus(dayKey: string) {
    if (!activeTeam || selectedWeek == null) return;
    const current = getStatus(dayKey);
    const idx = current ? CYCLE.indexOf(current) : -1;
    const next = CYCLE[(idx + 1) % CYCLE.length];
    if (!next) return;

    // Optimistic
    setEntries(prev => {
      const filtered = prev.filter(e => !(e.teamId === activeTeam.teamId && e.week === selectedWeek && e.day === dayKey));
      return [...filtered, { teamId: activeTeam.teamId, leagueId: activeTeam.leagueId, week: selectedWeek, day: dayKey, status: next, note: null }];
    });
    try {
      await api.setAvailability(activeTeam.leagueId, { teamId: activeTeam.teamId, week: selectedWeek, day: dayKey, status: next });
    } catch {
      toast.error('Failed to update availability');
      api.getAvailability(activeTeam.leagueId).then(setEntries).catch(() => {});
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange size={16} />
            Availability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (myTeams.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange size={16} />
            Availability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">
            You don't own a team in any active league. Availability is set per team.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange size={16} />
              Availability
            </CardTitle>
            <p className="text-xs text-text-muted mt-1">
              Click cells to cycle Available → Maybe → Busy. Visible to other coaches on the schedule.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {myTeams.length > 1 && (
              <select
                value={activeLeagueId ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  setActiveLeagueId(next);
                  const t = myTeams.find(m => m.leagueId === next);
                  setSelectedWeek(t?.currentWeek ?? 1);
                }}
                className="h-8 px-2 rounded border border-border-default bg-surface-overlay text-text-primary text-xs"
              >
                {myTeams.map(t => (
                  <option key={t.leagueId} value={t.leagueId}>
                    {t.leagueName.replace(' League', '')} — {t.teamAbbrev}
                  </option>
                ))}
              </select>
            )}
            {activeTeam && selectedWeek != null && (
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(parseInt(e.target.value, 10))}
                className="h-8 px-2 rounded border border-border-default bg-surface-overlay text-text-primary text-xs tabular-nums"
              >
                {Array.from({ length: activeTeam.totalWeeks }, (_, i) => i + 1).map(w => (
                  <option key={w} value={w}>Week {w}{w === activeTeam.currentWeek ? ' • current' : ''}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasDates && activeTeam && selectedWeek != null && (
          <p className="text-[11px] text-text-muted/70 italic">
            Dates TBD — calendar dates haven't been set for this week yet.
          </p>
        )}
        {activeTeam && selectedWeek != null ? (
          <div className="rounded-lg border border-border-default overflow-hidden">
            {/* Header row — days */}
            <div
              className="grid bg-surface-overlay/50 border-b border-border-subtle"
              style={{ gridTemplateColumns: `repeat(${weekDays.length}, 1fr)` }}
            >
              {weekDays.map(day => {
                const { short, date } = formatWeekDay(day);
                return (
                  <div key={day.key} className="px-1 py-2 text-center">
                    <div className="text-[11px] font-semibold text-text-secondary">{short}</div>
                    {date && (
                      <div className="text-[10px] text-text-muted tabular-nums">{date}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Editable row */}
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${weekDays.length}, 1fr)` }}
            >
              {weekDays.map(day => {
                const status = getStatus(day.key);
                const style = status ? STATUS_STYLES[status] : null;
                return (
                  <div key={day.key} className="px-1 py-2 flex items-center justify-center">
                    <button
                      onClick={() => cycleStatus(day.key)}
                      aria-label={style ? style.label : 'Not set — click to cycle availability'}
                      className={cn(
                        'w-full h-9 rounded text-[11px] font-semibold border transition-all flex items-center justify-center gap-1',
                        style
                          ? `${style.bg} ${style.text}`
                          : 'border-border-subtle text-text-muted/60 hover:border-border-default hover:text-text-muted',
                      )}
                    >
                      {style ? (
                        <>
                          <style.icon size={13} className="sm:hidden" aria-hidden="true" />
                          <span className="hidden sm:inline">{style.label}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">No active league selected.</p>
        )}
      </CardContent>
    </Card>
  );
}
