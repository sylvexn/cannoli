/**
 * Per-league season-progress visual for the Simulator tab.
 *
 * Renders a phase timeline (predraft → draft → regular → playoffs → offseason),
 * a week N/total bar, and completed/total match counts for both the regular
 * season and playoffs. Driven entirely by GET /api/admin/sim/state.
 */
import { Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApiSimLeague } from '@/lib/api';

const PHASES = ['predraft', 'draft', 'regular', 'playoffs', 'offseason'] as const;
type Phase = (typeof PHASES)[number];

const PHASE_LABEL: Record<Phase, string> = {
  predraft: 'Pre-Draft',
  draft: 'Draft',
  regular: 'Regular',
  playoffs: 'Playoffs',
  offseason: 'Offseason',
};

function MatchBar({ label, completed, total }: { label: string; completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="font-mono uppercase tracking-wider text-text-muted">{label}</span>
        <span className="font-mono text-text-secondary">
          {completed}<span className="text-text-muted">/{total}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
        <div
          className="h-full rounded-full bg-neon/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SeasonProgressCard({ league, seasonNumber }: { league: ApiSimLeague; seasonNumber: number }) {
  const activeIdx = PHASES.indexOf(league.phase as Phase);
  const weekPct = league.totalWeeks > 0
    ? Math.round((league.currentWeek / league.totalWeeks) * 100)
    : 0;

  return (
    <div className="rounded-lg border border-border-default bg-surface-base/60 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded border border-neon/30 bg-neon/5 px-1 py-0 text-[9px] font-mono font-bold uppercase tracking-wide text-neon">
          S{seasonNumber}
        </span>
        <h3 className="text-sm font-mono font-bold uppercase tracking-tight text-text-primary truncate">
          {league.name}
        </h3>
        {league.paused && (
          <span className="inline-flex items-center gap-1 rounded-full border border-draw/40 bg-draw/10 px-1.5 py-0 text-[9px] font-mono uppercase tracking-wider text-draw">
            <Pause size={9} /> Paused
          </span>
        )}
      </div>

      {/* Phase timeline */}
      <div className="flex items-center gap-1">
        {PHASES.map((phase, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <div key={phase} className="flex-1 min-w-0">
              <div
                className={cn(
                  'h-1 rounded-full transition-colors',
                  active ? 'bg-neon' : done ? 'bg-neon/40' : 'bg-surface-overlay',
                )}
              />
              <div
                className={cn(
                  'mt-1 text-center text-[8.5px] font-mono uppercase tracking-wide truncate',
                  active ? 'text-neon font-bold' : done ? 'text-text-secondary' : 'text-text-muted/60',
                )}
              >
                {PHASE_LABEL[phase]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Week progress */}
      <div>
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="font-mono uppercase tracking-wider text-text-muted">Week</span>
          <span className="font-mono text-text-secondary">
            {league.currentWeek}<span className="text-text-muted">/{league.totalWeeks}</span>
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
          <div
            className="h-full rounded-full bg-draw/70 transition-all"
            style={{ width: `${weekPct}%` }}
          />
        </div>
      </div>

      {/* Match counts */}
      <div className="grid grid-cols-2 gap-3">
        <MatchBar label="Regular" completed={league.regular.completed} total={league.regular.total} />
        <MatchBar label="Playoffs" completed={league.playoffs.completed} total={league.playoffs.total} />
      </div>
    </div>
  );
}
