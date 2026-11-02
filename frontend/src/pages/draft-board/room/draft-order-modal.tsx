import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/types';
import {
  shuffled, useDraftOrderApi, usePrevSeasonReverse, type DraftOrderHistoryEntry,
} from './use-draft-order';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leagueId: string;
  leagueName: string;
  seasonNumber?: number;
  teams: Player[];
  /** Current saved order (team ids). */
  order: string[];
  draftStarted: boolean;
  /** Called after a successful save (caller refetches the league). */
  onSaved: (order: string[], locked: boolean) => void | Promise<void>;
}

export function DraftOrderModal({
  open, onOpenChange, leagueId, leagueName, seasonNumber, teams, order, draftStarted, onSaved,
}: Props) {
  const [draft, setDraft] = useState<string[]>(order);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [history, setHistory] = useState<DraftOrderHistoryEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { save, loadHistory } = useDraftOrderApi(leagueId);
  const reverseFn = usePrevSeasonReverse(leagueName, seasonNumber, teams);
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams]);
  const listRef = useRef<HTMLOListElement>(null);

  // Reset to the saved order each time the modal opens; refresh history.
  useEffect(() => {
    if (!open) return;
    setDraft(order);
    setShowHistory(false);
    loadHistory().then(setHistory).catch(() => setHistory([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.length || from === to) return;
    setDraft(d => {
      const n = [...d];
      n.splice(to, 0, n.splice(from, 1)[0]);
      return n;
    });
  };

  const submit = async (locked: boolean) => {
    setBusy(true);
    try {
      await save(draft, locked);
      toast.success(locked ? 'Draft order locked and published' : 'Draft order saved');
      await onSaved(draft, locked);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save draft order');
    } finally {
      setBusy(false);
    }
  };

  const last = history?.[0];
  const frozen = busy || draftStarted;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[360px]">
        <DialogTitle className="font-mono text-sm uppercase tracking-[0.2em] text-pink">
          Draft order
        </DialogTitle>
        <DialogDescription className="sr-only">
          Drag teams, or focus a row and press Alt+Up / Alt+Down, to set the snake draft order.
        </DialogDescription>

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={frozen}
            onClick={() => setDraft(shuffled(draft))}>
            Shuffle
          </Button>
          {reverseFn && (
            <Button type="button" variant="outline" size="sm" disabled={frozen}
              onClick={() => setDraft(reverseFn())}>
              Reverse S{(seasonNumber ?? 1) - 1}
            </Button>
          )}
        </div>

        <ol ref={listRef} className="flex flex-col gap-1 max-h-[50dvh] overflow-y-auto pr-1">
          {draft.map((id, i) => {
            const t = byId.get(id);
            if (!t) return null;
            return (
              <li
                key={id}
                tabIndex={0}
                draggable={!frozen}
                onDragStart={() => setDragId(id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => { if (dragId) move(draft.indexOf(dragId), i); setDragId(null); }}
                onKeyDown={e => {
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                  e.preventDefault();
                  const to = i + (e.key === 'ArrowUp' ? -1 : 1);
                  move(i, to);
                  requestAnimationFrame(() => (listRef.current?.children[to] as HTMLElement | undefined)?.focus());
                }}
                className={cn(
                  'flex items-center gap-2 rounded-md border border-border-subtle bg-surface-raised px-2 h-9 outline-none focus-visible:ring-1 focus-visible:ring-pink/60',
                  dragId === id && 'opacity-40',
                )}
              >
                <GripVertical className="size-4 shrink-0 cursor-grab text-text-muted" />
                <span className="w-5 shrink-0 font-mono text-[11px] text-text-muted">{i + 1}</span>
                <span className="size-3 shrink-0 rounded-sm" style={{ background: t.teamColor }} />
                <span className="font-mono text-xs font-bold shrink-0">{t.teamAbbrev}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{t.teamName}</span>
                <button type="button" aria-label={`Move ${t.teamAbbrev} up`} disabled={i === 0 || frozen}
                  onClick={() => move(i, i - 1)}
                  className="shrink-0 size-6 grid place-items-center rounded text-text-muted hover:text-text-primary disabled:opacity-30">
                  <ArrowUp className="size-3.5" />
                </button>
                <button type="button" aria-label={`Move ${t.teamAbbrev} down`} disabled={i === draft.length - 1 || frozen}
                  onClick={() => move(i, i + 1)}
                  className="shrink-0 size-6 grid place-items-center rounded text-text-muted hover:text-text-primary disabled:opacity-30">
                  <ArrowDown className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ol>

        <div className="font-mono text-[10px] text-text-muted">
          {last
            ? <>{last.locked ? 'locked' : 'saved'} by {last.actor} {formatDateTime(last.at, { year: 'hide' })}</>
            : 'no history yet'}
          {history && history.length > 0 && (
            <> · <button type="button" className="underline hover:text-text-primary" onClick={() => setShowHistory(s => !s)}>history</button></>
          )}
          {showHistory && history && (
            <ul className="mt-1.5 max-h-24 overflow-y-auto space-y-0.5">
              {history.map((h, i) => (
                <li key={i} className="truncate">
                  {formatDateTime(h.at, { year: 'hide' })} · {h.actor}
                  {h.locked === true ? ' · locked' : h.locked === false ? ' · saved' : ''}
                  {' · '}{h.order.map(id => byId.get(id)?.teamAbbrev ?? '?').join(' ')}
                </li>
              ))}
            </ul>
          )}
        </div>

        {draftStarted && (
          <p className="text-xs text-loss">The draft has started — the order can no longer be changed.</p>
        )}
        <div className="flex flex-col gap-2">
          <Button type="button" disabled={frozen} onClick={() => submit(true)}
            className="bg-pink text-black hover:bg-pink/90">
            Lock &amp; publish order
          </Button>
          <Button type="button" variant="outline" disabled={frozen} onClick={() => submit(false)}>
            Save draft
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
