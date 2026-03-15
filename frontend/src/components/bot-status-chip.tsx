import { useEffect, useState } from 'react';
import { api, type ApiBotStatus } from '@/lib/api';
import {
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui/popover';
import { Bot } from 'lucide-react';

const HEALTH_COLORS = {
  green: 'bg-win',
  yellow: 'bg-draw',
  red: 'bg-loss',
} as const;

const HEALTH_LABELS = {
  green: 'Bot online',
  yellow: 'Bot idle',
  red: 'Bot down',
} as const;

function formatRelative(iso: string | null) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function BotStatusChip() {
  const [status, setStatus] = useState<ApiBotStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    const tick = () => {
      api.getBotStatus()
        .then(s => { if (mounted) { setStatus(s); setError(false); } })
        .catch(() => { if (mounted) setError(true); });
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  if (error || !status) {
    return null; // hide chip on error / before first load
  }

  const dot = HEALTH_COLORS[status.health];
  const label = HEALTH_LABELS[status.health];

  return (
    <Popover>
      <PopoverTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono text-text-muted hover:text-text-secondary hover:bg-surface-overlay transition-colors">
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`}>
          {status.health === 'green' && (
            <span className={`absolute inset-0 rounded-full ${dot} opacity-50 animate-ping`} />
          )}
        </span>
        <Bot size={12} />
        <span className="uppercase tracking-wider">{label}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 text-xs space-y-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-2 w-2 rounded-full ${dot}`} />
          <span className="font-medium text-text-primary">{label}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-text-muted">
          <dt>Authed as</dt><dd className="text-text-secondary font-mono">{status.authedAs ?? '—'}</dd>
          <dt>Last event</dt><dd className="text-text-secondary">{formatRelative(status.lastEventAt)}</dd>
          <dt>Reconnect attempts</dt><dd className="text-text-secondary font-mono">{status.reconnectAttempts}</dd>
          <dt>Battles monitored</dt><dd className="text-text-secondary font-mono">{status.monitoredBattles.length}</dd>
        </dl>
        {status.monitoredBattles.length > 0 && (
          <ul className="text-[10px] font-mono text-text-muted border-t border-border-subtle pt-2 space-y-0.5 max-h-24 overflow-y-auto">
            {status.monitoredBattles.map(b => (
              <li key={b.roomId} className="truncate">
                {b.roomId} {b.matchId ? `→ ${b.matchId}` : ''} ({b.p1} vs {b.p2})
              </li>
            ))}
          </ul>
        )}
        {status.lastError && (
          <div className="text-[10px] text-loss border-t border-border-subtle pt-2">
            <div className="font-medium">Last error ({formatRelative(status.lastErrorAt)}):</div>
            <div className="font-mono break-words">{status.lastError}</div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
