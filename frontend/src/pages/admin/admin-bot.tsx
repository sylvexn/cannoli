import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, type ApiBotStatus } from '@/lib/api';
import { Bot, RefreshCw, Plug, Activity, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';

const HEALTH_COLORS: Record<ApiBotStatus['health'], string> = {
  green: 'bg-win',
  yellow: 'bg-draw',
  red: 'bg-loss',
};

const HEALTH_LABELS: Record<ApiBotStatus['health'], string> = {
  green: 'Online',
  yellow: 'Idle',
  red: 'Offline',
};

const HEALTH_TEXT: Record<ApiBotStatus['health'], string> = {
  green: 'text-win',
  yellow: 'text-draw',
  red: 'text-loss',
};

function formatRelative(iso: string | null): string {
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

export function AdminBot() {
  const [status, setStatus] = useState<ApiBotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [tick, setTick] = useState(0); // forces relative-time refresh

  const refresh = useCallback(() => {
    setLoading(true);
    api.getBotStatus()
      .then(s => setStatus(s))
      .catch(() => toast.error('Failed to load bot status'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    const tickId = setInterval(() => setTick(t => t + 1), 5_000);
    return () => { clearInterval(id); clearInterval(tickId); };
  }, [refresh]);

  // tick is read implicitly via re-render; reference it so eslint stays calm
  void tick;

  async function handleReconnect() {
    if (!confirm('Force-reconnect the PS Monitor Bot? Active battle observers will be re-joined automatically.')) return;
    setReconnecting(true);
    try {
      await api.reconnectBot();
      toast.success('Reconnect requested');
      // Bot needs a moment to drop+rejoin; re-poll a couple of times.
      setTimeout(refresh, 1000);
      setTimeout(refresh, 3000);
    } catch (err: any) {
      toast.error(err?.message ?? 'Reconnect failed');
    } finally {
      setReconnecting(false);
    }
  }

  if (loading && !status) {
    return <LoadingSprite size="md" padding="md" />;
  }

  if (!status) {
    return (
      <EmptyState
        variant="quiet"
        title="Bot status unavailable."
        subtitle="Backend may be unreachable, or bot is disabled in this environment."
        spriteSize="md"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header card — health pill + primary actions */}
      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <div className={cn('shrink-0 w-12 h-12 rounded-md flex items-center justify-center', HEALTH_COLORS[status.health], 'bg-opacity-10')}>
            <Bot size={24} className={HEALTH_TEXT[status.health]} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={cn('relative inline-flex h-2 w-2 rounded-full', HEALTH_COLORS[status.health])}>
                {status.health === 'green' && (
                  <span className={cn('absolute inset-0 rounded-full opacity-50 animate-ping', HEALTH_COLORS[status.health])} />
                )}
              </span>
              <span className={cn('text-sm font-mono uppercase tracking-wider font-medium', HEALTH_TEXT[status.health])}>
                {HEALTH_LABELS[status.health]}
              </span>
              {status.connected && (
                <Badge variant="outline" className="text-[10px] border-text-muted/30 text-text-muted">
                  WS connected
                </Badge>
              )}
            </div>
            <div className="text-xs text-text-muted">
              Authed as <span className="font-mono text-text-secondary">{status.authedAs ?? '—'}</span>
              {' · '}
              Last event <span className="text-text-secondary">{formatRelative(status.lastEventAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="h-8">
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleReconnect} disabled={reconnecting} className="h-8">
              <Plug size={14} />
              {reconnecting ? 'Reconnecting...' : 'Force reconnect'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Connection" value={status.connected ? 'Open' : 'Closed'} tone={status.connected ? 'win' : 'loss'} />
        <StatCard label="Reconnect attempts" value={String(status.reconnectAttempts)} tone={status.reconnectAttempts > 0 ? 'draw' : 'muted'} />
        <StatCard label="Battles monitored" value={String(status.monitoredBattles.length)} tone="muted" />
        <StatCard label="Last event" value={formatRelative(status.lastEventAt)} tone="muted" />
      </div>

      {/* Monitored battles */}
      <section className="rounded-md border border-border-default bg-surface-raised/30 overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
          <Activity size={14} className="text-text-muted" />
          <h3 className="text-xs font-mono uppercase tracking-wider text-text-secondary">Monitored battles</h3>
          <Badge variant="outline" className="text-[10px] ml-auto border-text-muted/30 text-text-muted">
            {status.monitoredBattles.length}
          </Badge>
        </header>
        {status.monitoredBattles.length === 0 ? (
          <EmptyState
            variant="quiet"
            title="No active battle observers."
            subtitle="Bot only joins rooms when a Cannoli match goes live."
            spriteSize="md"
            padding="sm"
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {status.monitoredBattles.map(b => (
              <li key={b.roomId} className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-surface-overlay/30 transition-colors">
                <span className="font-mono text-text-secondary truncate max-w-[280px]">{b.roomId}</span>
                <span className="text-text-muted">·</span>
                <span className="text-text-primary truncate flex-1">
                  {b.p1} <span className="text-text-muted">vs</span> {b.p2}
                </span>
                {b.matchId && (
                  <Badge variant="outline" className="text-[10px] border-neon/30 text-neon font-mono">
                    {b.matchId}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Last error */}
      {status.lastError && (
        <section className="rounded-md border border-loss/30 bg-loss/5 p-3 text-xs space-y-1">
          <div className="flex items-center gap-2 text-loss font-mono uppercase tracking-wider text-[11px]">
            <AlertTriangle size={12} />
            Last error
            <span className="text-text-muted ml-auto font-normal">{formatRelative(status.lastErrorAt)}</span>
          </div>
          <div className="font-mono text-text-secondary break-words pl-5">
            {status.lastError}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: 'win' | 'loss' | 'draw' | 'muted' }) {
  const toneClass: Record<typeof tone, string> = {
    win: 'text-win',
    loss: 'text-loss',
    draw: 'text-draw',
    muted: 'text-text-primary',
  } as const;
  return (
    <div className="rounded-md border border-border-default bg-surface-raised/30 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-0.5">
        {label}
      </div>
      <div className={cn('text-lg font-mono font-medium tabular-nums', toneClass[tone])}>
        {value}
      </div>
    </div>
  );
}
