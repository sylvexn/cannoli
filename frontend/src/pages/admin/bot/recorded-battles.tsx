/**
 * RecordedBattles — lists Pokémon Showdown battles autosaved on the PS server.
 *
 * Renders on the PS bot admin page after "Monitored battles". Each row is an
 * expandable summary (lazy-fetches per-battle detail on first open) with a
 * download button for the raw .log.json. The high-value signal is the amber
 * "recoverable" badge: PS recorded a replay the bot never attached to its match.
 */

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import {
  api,
  type PsReplayRow,
  type PsReplayDetail,
  type PsReplayListResponse,
  type PsReplayLinkStatus,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Film, RefreshCw, Download } from 'lucide-react';

/** "[Gen 9] NatDex Draft" -> "NatDex Draft". */
function shortFormat(format: string): string {
  return format.replace(/^\[[^\]]+\]\s*/, '').trim() || format;
}

function linkBadgeClasses(status: PsReplayLinkStatus): string {
  if (status === 'recoverable') return 'border-draw/40 text-draw bg-draw/10';
  if (status === 'attached') return 'border-text-muted/30 text-text-muted';
  return 'border-text-muted/20 text-text-muted/70';
}

function LinkBadge({ row }: { row: PsReplayRow }) {
  const { linkStatus, matchId } = row;
  let label: string;
  if (linkStatus === 'attached') label = `linked · ${matchId ?? '—'}`;
  else if (linkStatus === 'recoverable') label = `not attached · ${matchId ?? '—'}`;
  else label = 'no match';
  return (
    <Badge variant="outline" className={cn('shrink-0 text-[10px] font-mono', linkBadgeClasses(linkStatus))}>
      {label}
    </Badge>
  );
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function ReplayDetail({ row }: { row: PsReplayRow }) {
  const [detail, setDetail] = useState<PsReplayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    api.getPsReplayDetail(row.roomId)
      .then(d => { if (alive) setDetail(d); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [row.roomId]);

  const downloadUrl = api.psReplayDownloadUrl(row.roomId);

  return (
    <div className="px-3 pb-3 pl-9 space-y-3 text-[11px]">
      {row.linkStatus === 'recoverable' && (
        <p className="text-draw font-mono text-[10px]">
          Bot missed this — match {row.matchId ?? '?'} has no replay attached.
        </p>
      )}

      {loading && <p className="text-text-muted">Loading details…</p>}
      {failed && <p className="text-loss">Failed to load battle detail.</p>}

      {detail && (
        <>
          {/* Brought teams */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
            <BroughtTeam label={detail.p1} species={detail.p1Brought} />
            <BroughtTeam label={detail.p2} species={detail.p2Brought} />
          </div>

          {/* Per-Pokémon K/D grid */}
          {detail.pokemon.length > 0 && (
            <div className="rounded border border-border-default overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border-subtle">
                <KdColumn player="p1" label={detail.p1} mons={detail.pokemon.filter(m => m.player === 'p1')} />
                <KdColumn player="p2" label={detail.p2} mons={detail.pokemon.filter(m => m.player === 'p2')} />
              </div>
            </div>
          )}

          {/* Meta line */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-text-muted font-mono">
            {detail.score && (
              <span>score: <span className="text-text-secondary">{detail.score[0]}–{detail.score[1]}</span></span>
            )}
            {detail.endType && (
              <span>end: <span className="text-text-secondary">{detail.endType}</span></span>
            )}
            <span>room: <span className="text-text-secondary">{detail.roomId}</span></span>
          </div>
        </>
      )}

      {/* Download — plain anchor (cookies ride same-origin navigation). */}
      <div>
        <a
          href={downloadUrl}
          download={row.roomId + '.log.json'}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-[11px]')}
        >
          <Download size={11} className="mr-1" />
          Download replay (.log.json)
        </a>
      </div>
    </div>
  );
}

function BroughtTeam({ label, species }: { label: string; species: string[] }) {
  return (
    <div>
      <span className="text-text-muted uppercase tracking-wide text-[9px]">{label} brought</span>
      <p className="text-text-secondary truncate">
        {species.length > 0 ? species.join(', ') : '—'}
      </p>
    </div>
  );
}

function KdColumn({
  player, label, mons,
}: {
  player: 'p1' | 'p2';
  label: string;
  mons: PsReplayDetail['pokemon'];
}) {
  return (
    <div className="p-2 space-y-0.5">
      <div className="text-text-muted uppercase tracking-wide text-[9px] mb-1">{label}</div>
      {mons.length === 0 ? (
        <p className="text-text-muted/70">—</p>
      ) : (
        mons.map(m => (
          <div key={`${player}-${m.species}`} className="flex items-center gap-2 font-mono text-[10px]">
            <span className="text-text-secondary truncate flex-1">{m.species}</span>
            {m.teraUsed && (
              <Badge variant="outline" className="border-neon/30 text-neon text-[8px] h-3.5 px-1 shrink-0">
                tera{m.teraType ? ` ${m.teraType}` : ''}
              </Badge>
            )}
            <span className="text-text-muted tabular-nums shrink-0">
              {m.kills}<span className="text-text-muted/50">/</span>{m.deaths}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ReplayRow({ row }: { row: PsReplayRow }) {
  const [open, setOpen] = useState(false);

  const winnerIsP1 = row.winner != null && row.winner === row.p1;
  const winnerIsP2 = row.winner != null && row.winner === row.p2;

  return (
    <div className={cn('transition-colors', open && 'bg-surface-overlay/30')}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left text-xs hover:bg-surface-overlay/50 transition-colors"
      >
        <span className="shrink-0 w-3 text-text-muted">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {/* Time */}
        <span className="shrink-0 w-16 font-mono text-[10px] text-text-muted tabular-nums">
          {row.playedAt ? formatRelativeTime(row.playedAt) : '—'}
        </span>

        {/* Format */}
        <span className="shrink-0 hidden sm:inline font-mono text-[10px] text-text-muted truncate max-w-[120px]">
          {shortFormat(row.format)}
        </span>

        {/* Players */}
        <span className="text-text-primary truncate flex-1 min-w-0">
          <span className={cn(winnerIsP1 && 'font-medium text-neon')}>{row.p1}</span>
          <span className="text-text-muted"> vs </span>
          <span className={cn(winnerIsP2 && 'font-medium text-neon')}>{row.p2}</span>
        </span>

        {/* Turns */}
        {row.turns != null && (
          <span className="shrink-0 font-mono text-[10px] text-text-muted tabular-nums w-9 text-right">
            {row.turns}t
          </span>
        )}

        <LinkBadge row={row} />
      </button>

      {open && <ReplayDetail row={row} />}
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

export function RecordedBattles() {
  const [data, setData] = useState<PsReplayListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api.listPsReplays(100)
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Volume not mounted — render a single muted notice and nothing else.
  if (data && !data.available) {
    return (
      <section className="rounded-md border border-border-default bg-surface-raised/30 overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
          <Film size={14} className="text-text-muted" />
          <h3 className="text-xs font-mono uppercase tracking-wider text-text-secondary">Recorded battles</h3>
        </header>
        <p className="px-3 py-3 text-xs text-text-muted">
          PS logs volume not mounted ({data.dir}) — recorded battles unavailable.
        </p>
      </section>
    );
  }

  const replays = data?.replays ?? [];

  return (
    <section className="rounded-md border border-border-default bg-surface-raised/30 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <Film size={14} className="text-text-muted" />
        <h3 className="text-xs font-mono uppercase tracking-wider text-text-secondary">Recorded battles</h3>
        <Badge variant="outline" className="text-[10px] border-text-muted/30 text-text-muted">
          {data?.total ?? replays.length}
        </Badge>
        {data?.truncated && (
          <span className="text-[10px] text-text-muted font-mono">
            showing {replays.length} of {data.total}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="h-7 ml-auto text-text-muted hover:text-text-primary"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
        </Button>
      </header>

      {loading && !data ? (
        <p className="px-3 py-3 text-xs text-text-muted">Loading recorded battles…</p>
      ) : failed ? (
        <p className="px-3 py-3 text-xs text-loss">Failed to load recorded battles.</p>
      ) : replays.length === 0 ? (
        <p className="px-3 py-3 text-xs text-text-muted">No recorded battles found.</p>
      ) : (
        <div className="divide-y divide-border-subtle">
          {replays.map(row => (
            <ReplayRow key={row.roomId} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}
