/**
 * Observability — dev-only dashboard composing HealthPanel, TrendsPanel,
 * and the ErrorGroupsPanel triage queue.
 *
 * This file is the composition root only. Heavy pieces live in sibling files.
 * Routing + nav registration is handled externally; just export Observability.
 */

import { Activity } from 'lucide-react';
import { HealthPanel } from './health-panel';
import { TrendsPanel } from './trends-panel';
import { ErrorGroupsPanel } from './error-groups-panel';

export function Observability() {
  return (
    <div className="space-y-4">
      {/* Page title */}
      <div className="flex items-center gap-2">
        <Activity size={16} className="text-neon shrink-0" />
        <h1 className="font-mono text-base font-semibold uppercase tracking-widest">
          <span className="text-neon">OBSERV</span>{' '}
          <span className="text-text-primary">ABILITY</span>
        </h1>
      </div>

      {/* Health + Trends strip */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <HealthPanel />
        <TrendsPanel />
      </div>

      {/* Error group triage queue */}
      <ErrorGroupsPanel />
    </div>
  );
}
