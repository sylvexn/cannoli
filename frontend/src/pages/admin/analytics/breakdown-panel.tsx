/**
 * BreakdownPanel — device split and top external referrers, compact and
 * side by side.
 */
import { Monitor, Smartphone, MonitorSmartphone, Globe } from 'lucide-react';
import type { ApiAnalyticsSummary } from '@/lib/api';
import { Panel, PanelEmpty, BarRow } from './panel';

interface BreakdownPanelProps {
  devices: ApiAnalyticsSummary['devices'];
  referrers: ApiAnalyticsSummary['referrers'];
  loading: boolean;
}

function deviceIcon(device: string) {
  if (device === 'desktop') return <Monitor size={12} className="text-text-muted shrink-0" />;
  if (device === 'mobile') return <Smartphone size={12} className="text-text-muted shrink-0" />;
  return <MonitorSmartphone size={12} className="text-text-muted shrink-0" />;
}

export function BreakdownPanel({ devices, referrers, loading }: BreakdownPanelProps) {
  const deviceTotal = devices.reduce((s, d) => s + d.views, 0);
  const maxReferrer = referrers.reduce((m, r) => Math.max(m, r.views), 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Panel icon={MonitorSmartphone} title="Devices">
        {devices.length === 0 ? (
          <PanelEmpty label={loading ? 'Loading…' : 'No device data yet.'} />
        ) : (
          <div className="space-y-0.5">
            {devices.map(d => {
              const pct = deviceTotal > 0 ? (d.views / deviceTotal) * 100 : 0;
              return (
                <BarRow key={d.device} pct={pct}>
                  {deviceIcon(d.device)}
                  <span className="relative flex-1 min-w-0 truncate text-text-secondary capitalize">
                    {d.device}
                  </span>
                  <span className="relative shrink-0 font-mono tabular-nums text-text-muted">
                    {Math.round(pct)}%
                  </span>
                  <span className="relative w-14 text-right shrink-0 font-mono tabular-nums text-text-primary">
                    {d.views.toLocaleString()}
                  </span>
                </BarRow>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel icon={Globe} title="Top referrers">
        {referrers.length === 0 ? (
          <PanelEmpty label={loading ? 'Loading…' : 'No external referrers yet.'} />
        ) : (
          <div className="space-y-0.5">
            {referrers.map(r => (
              <BarRow key={r.referrer} pct={maxReferrer > 0 ? (r.views / maxReferrer) * 100 : 0}>
                <span className="relative flex-1 min-w-0 truncate font-mono text-text-secondary" title={r.referrer}>
                  {r.referrer}
                </span>
                <span className="relative w-14 text-right shrink-0 font-mono tabular-nums text-text-primary">
                  {r.views.toLocaleString()}
                </span>
              </BarRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
