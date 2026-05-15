/**
 * Season Simulator admin tab — mock.cannoli.live only.
 *
 * The mock deployment is an interactive season simulator; this page is the
 * control surface. Owns the GET /api/admin/sim/state query and passes the
 * refetch down to every card so each action re-syncs the view.
 *
 * The route element guards on mode !== 'mock' (redirect to /admin); this
 * component additionally renders a friendly notice if it ever loads on live.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  FlaskConical, RefreshCw, GaugeCircle, SlidersHorizontal, RotateCcw, Cog, AlertTriangle,
} from 'lucide-react';
import { api, type ApiSimState } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { SeasonProgressCard } from './sim/season-progress-card';
import { SimControlsCard } from './sim/sim-controls-card';
import { ResetControlsCard } from './sim/reset-controls-card';
import { JobTriggerCard } from './sim/job-trigger-card';

function CardShell({
  icon: Icon, title, accent, children,
}: {
  icon: typeof GaugeCircle;
  title: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-raised/30 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <Icon size={13} className={accent ?? 'text-text-muted'} />
        <h3 className="text-[12px] font-mono font-bold uppercase tracking-wide text-text-primary">
          {title}
        </h3>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function AdminSim() {
  const [state, setState] = useState<ApiSimState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    api.getSimState()
      .then(s => { setState(s); setError(null); })
      .catch((err: any) => setError(err?.message ?? 'Failed to load simulator state'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  if (loading) {
    return <div className="py-12 text-center text-sm text-text-muted font-mono">Loading simulator…</div>;
  }

  if (error || !state) {
    return (
      <div className="py-12 flex flex-col items-center gap-3 text-center">
        <AlertTriangle size={24} className="text-loss" />
        <p className="text-sm text-text-secondary">{error ?? 'Simulator state unavailable'}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw size={13} /> Retry
        </Button>
      </div>
    );
  }

  if (state.mode !== 'mock') {
    return (
      <div className="py-12 flex flex-col items-center gap-2 text-center">
        <FlaskConical size={24} className="text-text-muted" />
        <p className="text-sm text-text-secondary">
          The simulator is only available on the mock deployment.
        </p>
      </div>
    );
  }

  const { leagues } = state;

  return (
    <div className="space-y-5">
      {/* Split-color page title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <FlaskConical size={20} className="text-draw" />
          <h1 className="text-xl font-mono font-bold tracking-tight uppercase">
            <span className="text-draw">Season</span>{' '}
            <span className="text-text-primary">Simulator</span>
          </h1>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={refetch}>
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>
      <p className="-mt-3 text-[11px] text-text-muted">
        Drive the fictional mock seasons — advance weeks, simulate matches, jump
        phases, and reset state. All actions hit the mock database only.
      </p>

      {leagues.length === 0 ? (
        <div className="py-10 text-center text-sm text-text-muted">
          No simulator leagues found. Run a Full Reset to seed the fictional seasons.
        </div>
      ) : (
        <>
          {/* Season progress */}
          <CardShell icon={GaugeCircle} title="Season Progress" accent="text-neon">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {leagues.map(l => (
                <SeasonProgressCard key={l.id} league={l} />
              ))}
            </div>
          </CardShell>

          {/* Sim controls */}
          <CardShell icon={SlidersHorizontal} title="Simulator Controls" accent="text-draw">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {leagues.map(l => (
                <SimControlsCard key={l.id} league={l} onChanged={refetch} />
              ))}
            </div>
          </CardShell>
        </>
      )}

      {/* Reset controls */}
      <CardShell icon={RotateCcw} title="Reset Controls" accent="text-loss">
        <ResetControlsCard leagues={leagues} onChanged={refetch} />
      </CardShell>

      {/* Job triggers */}
      <CardShell icon={Cog} title="Background Jobs" accent="text-pink">
        <JobTriggerCard />
      </CardShell>
    </div>
  );
}
