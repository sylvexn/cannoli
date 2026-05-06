import { Card, CardContent } from '@/components/ui/card';
import { Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ApiLeague } from '@/lib/api';
import type { EditableLeague } from './phase-config';

interface Props {
  leagueList: EditableLeague[];
  leagueStates: Record<string, { totalWeeks: number; weekDates?: Record<string, string> } & Record<string, any>>;
  defaultLeagues: ApiLeague[];
  refreshLeagues?: () => void;
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
                    } catch (err: any) { toast.error(err.message); }
                  }}
                  className="flex-1 h-7 px-2 rounded border border-border-default bg-surface-overlay text-text-primary text-xs font-mono"
                />
              </div>

              {/* Week dates */}
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Week Dates</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                  {Array.from({ length: state.totalWeeks }, (_, i) => i + 1).map(week => (
                    <div key={week} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-text-muted font-mono w-5 text-right shrink-0">W{week}</span>
                      <input
                        type="date"
                        defaultValue={existingDates[String(week)] ?? ''}
                        onBlur={async (e) => {
                          const newDates = { ...existingDates };
                          if (e.target.value) {
                            newDates[String(week)] = e.target.value;
                          } else {
                            delete newDates[String(week)];
                          }
                          try {
                            await api.updateLeague(league.id, { weekDates: newDates });
                            toast.success(`Week ${week} date saved`);
                            refreshLeagues?.();
                          } catch (err: any) { toast.error(err.message); }
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
