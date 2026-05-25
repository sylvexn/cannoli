import { Card, CardContent } from '@/components/ui/card';
import { Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ApiLeague } from '@/lib/api';
import type { EditableLeague } from './phase-config';
import { getErrorMessage } from '@/lib/errors';

interface Props {
  leagueList: EditableLeague[];
  leagueStates: Record<string, {
    totalWeeks: number;
    weekDates?: Record<string, string>;
    weekDatesAutoFilled?: boolean;
  } & Record<string, any>>;
  defaultLeagues: ApiLeague[];
  refreshLeagues?: () => void;
}

/**
 * Compute weeks 2..N as week1 + (n-1)*7 days, in YYYY-MM-DD form.
 * Pure local-date math — no time zone normalization, since the input is a
 * `<input type="date">` value (always local-date with no time component).
 */
function autoFillWeeks(week1: string, totalWeeks: number): Record<string, string> {
  const out: Record<string, string> = { '1': week1 };
  // Parse YYYY-MM-DD as a local date to avoid UTC-shift across timezones.
  const [y, m, d] = week1.split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return out;
  for (let week = 2; week <= totalWeeks; week++) {
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + (week - 1) * 7);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    out[String(week)] = iso;
  }
  return out;
}

export function SeasonScheduleDates({ leagueList, leagueStates, defaultLeagues, refreshLeagues }: Props) {
  return (
    <div className="space-y-3 pt-2">
      <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
        <Calendar size={12} />
        Schedule Dates
      </h3>
      {leagueList.map(league => {
        const state = leagueStates[league.id];
        if (!state || !state.totalWeeks) return null;
        const existingDates: Record<string, string> = state.weekDates ?? {};
        const autoFilled = !!state.weekDatesAutoFilled;
        const draftDate = defaultLeagues.find(l => l.id === league.id)?.draftDate ?? '';

        return (
          <Card key={league.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
                <span className="text-sm font-medium text-text-primary">{league.name}</span>
              </div>

              {/* Draft date */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-muted w-20 shrink-0">Draft Date</label>
                <input
                  type="datetime-local"
                  defaultValue={draftDate?.replace('Z', '').slice(0, 16) ?? ''}
                  onBlur={async (e) => {
                    const val = e.target.value;
                    try {
                      await api.updateLeague(league.id, { draftDate: val ? new Date(val).toISOString() : null });
                      toast.success('Draft date saved');
                      refreshLeagues?.();
                    } catch (err: unknown) { toast.error(getErrorMessage(err)); }
                  }}
                  className="flex-1 h-7 px-2 rounded border border-border-default bg-surface-overlay text-text-primary text-xs font-mono"
                />
              </div>

              {/* Week dates */}
              <div className="space-y-1">
                <label className="text-xs text-text-muted">
                  Week Dates
                  {!autoFilled && (
                    <span className="ml-2 text-[10px] text-text-muted/70 font-normal">
                      (saving Week 1 will auto-fill remaining weeks at +7d each — one-time)
                    </span>
                  )}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                  {Array.from({ length: state.totalWeeks }, (_, i) => i + 1).map(week => (
                    <div key={week} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-text-muted font-mono w-5 text-right shrink-0">W{week}</span>
                      <input
                        type="date"
                        // `key` baked from the auto-filled snapshot value so the
                        // uncontrolled input picks up post-auto-fill defaults
                        // without a remount loop.
                        key={`w${week}-${existingDates[String(week)] ?? ''}-${autoFilled ? 1 : 0}`}
                        defaultValue={existingDates[String(week)] ?? ''}
                        onBlur={async (e) => {
                          const newDates = { ...existingDates };
                          if (e.target.value) {
                            newDates[String(week)] = e.target.value;
                          } else {
                            delete newDates[String(week)];
                          }

                          // One-time auto-fill: if this is week 1, the league
                          // hasn't been auto-filled yet, week 1 has a value,
                          // and all other weeks are still empty → populate
                          // weeks 2..N at week1 + (n-1)*7d. Then latch the
                          // flag so this never runs again.
                          let payload: Record<string, unknown> = { weekDates: newDates };
                          if (week === 1 && e.target.value && !autoFilled) {
                            const otherWeeksEmpty = Array.from({ length: state.totalWeeks - 1 }, (_, i) => i + 2)
                              .every(w => !existingDates[String(w)]);
                            if (otherWeeksEmpty) {
                              const filled = autoFillWeeks(e.target.value, state.totalWeeks);
                              payload = { weekDates: filled, weekDatesAutoFilled: true };
                            } else {
                              // Manual edits already exist on later weeks —
                              // latch the flag without rewriting them.
                              payload = { weekDates: newDates, weekDatesAutoFilled: true };
                            }
                          } else if (!autoFilled) {
                            // Any manual edit (any week) latches the flag so a
                            // later week-1 save can't retroactively clobber.
                            payload = { weekDates: newDates, weekDatesAutoFilled: true };
                          }

                          try {
                            await api.updateLeague(league.id, payload);
                            const autoMsg = (payload.weekDatesAutoFilled && week === 1 && !autoFilled
                              && Object.keys(payload.weekDates as Record<string, string>).length > 1)
                              ? ` (auto-filled W2..W${state.totalWeeks})`
                              : '';
                            toast.success(`Week ${week} date saved${autoMsg}`);
                            refreshLeagues?.();
                          } catch (err: unknown) { toast.error(getErrorMessage(err)); }
                        }}
                        className="flex-1 h-6 px-1.5 rounded border border-border-default bg-surface-overlay text-text-primary text-[10px] font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
