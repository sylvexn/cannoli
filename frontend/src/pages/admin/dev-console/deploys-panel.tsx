import { useCallback, useEffect, useState } from 'react';
import { CircleDashed, CircleHelp, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { devConsoleApi, type DevDeploys, type DeployApp } from '@/lib/api-dev-console';

const HEALTH_CLS: Record<DeployApp['health'], string> = {
  healthy: 'border-win/40 text-win bg-win/10',
  degraded: 'border-loss/40 text-loss bg-loss/10',
  stopped: 'border-border-default text-text-muted',
  unknown: 'border-border-default text-text-muted',
};

function ago(iso: string | null): string {
  if (!iso) return '-';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s)) return '-';
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function uptime(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function DeploysPanel() {
  const [data, setData] = useState<DevDeploys | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await devConsoleApi.deploys()); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  const d = data?.deploys;
  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-muted">
          Deploys <span className="normal-case tracking-normal">via Coolify API, refreshed every 30s</span>
        </h3>
        <Button size="sm" variant="ghost" className="h-6 px-2 ml-auto" onClick={load} disabled={busy} aria-label="Refresh deploys">
          <RefreshCw size={12} className={cn(busy && 'animate-spin')} />
        </Button>
      </div>
      {data && (
        <div className="mb-2 text-[11px] text-text-muted font-mono flex flex-wrap gap-x-4 gap-y-0.5">
          <span>this backend: <span className="text-text-secondary">{data.self.commit}</span></span>
          <span>uptime: <span className="text-text-secondary">{uptime(data.self.uptimeSeconds)}</span></span>
          <span>mode: <span className="text-text-secondary">{data.self.mode}</span></span>
        </div>
      )}
      {err && <div className="text-[12px] text-loss mb-2">{err}</div>}
      {d && !d.configured && (
        <div className="rounded-lg border border-dashed border-border-default p-4 text-[12px] text-text-muted flex items-start gap-2">
          <CircleHelp size={14} className="mt-0.5 shrink-0" />
          <span>Not configured. Set <code className="font-mono text-text-secondary">COOLIFY_API_URL</code> and <code className="font-mono text-text-secondary">COOLIFY_API_TOKEN</code> (read-only) on this backend.</span>
        </div>
      )}
      {d?.configured && d.error && <div className="text-[12px] text-loss mb-2">Coolify: {d.error}</div>}
      {d?.configured && !d.error && (
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-overlay/40 text-text-muted text-left"><tr>
              {['App', 'Image', 'Commit', 'Last deploy', 'Health'].map((h, i) => (
                <th key={h} className={cn('px-3 py-1.5 font-normal', i === 1 && 'hidden md:table-cell', i === 2 && 'hidden sm:table-cell')}>{h}</th>
              ))}</tr></thead>
            <tbody>
              {d.apps.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-text-muted">No cannoli-* apps returned.</td></tr>}
              {d.apps.map(a => (
                <tr key={a.name} className="border-t border-border-subtle">
                  <td className="px-3 py-1.5"><div className="font-mono text-text-primary">{a.name}</div><div className="text-[10px] text-text-muted">{a.fqdn?.replace(/^https?:\/\//, '') || 'internal'}</div></td>
                  <td className="px-3 py-1.5 font-mono text-text-muted hidden md:table-cell max-w-[220px] truncate">{a.image ?? '-'}</td>
                  <td className="px-3 py-1.5 font-mono text-text-muted hidden sm:table-cell">{a.commit ?? '-'}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-text-muted" title={a.lastDeployAt ?? ''}>{ago(a.lastDeployAt)}{a.deployStatus && a.deployStatus !== 'finished' ? ` (${a.deployStatus})` : ''}</td>
                  <td className="px-3 py-1.5">
                    <span title={a.status} className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono', HEALTH_CLS[a.health])}>
                      {a.health === 'stopped' && <CircleDashed size={9} className="mr-1" />}{a.health}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
