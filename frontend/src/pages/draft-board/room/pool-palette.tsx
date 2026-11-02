import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

interface PoolPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Search + filter chips. */
  filters: ReactNode;
  /** Shelf/Table + density controls. */
  viewControls: ReactNode;
  /** Pool (shelves or table). */
  children: ReactNode;
  /** Right column (budget / queue / team). Omitted when there is no user team. */
  side?: ReactNode;
  /** Live clock text for the footer (null = hidden). */
  clock?: string | null;
  /** Draft/queue shortcuts are inert while a popover or detail sheet is on top. */
  blocked: boolean;
  /** `Q` — queue the hovered Pokemon. Omit outside a live draft. */
  onQueueKey?: () => void;
  /** `Enter` / primary button — draft the target. */
  onDraft?: () => void;
  draftLabel?: string;
  canDraft?: boolean;
}

/** Centered modal "palette" over the dimmed board. Plain portal (not the Dialog
 *  primitive): the quick-draft popover and detail sheet are sibling portals and
 *  a modal Dialog would mark them inert. */
export function PoolPalette({
  open, onClose, filters, viewControls, children, side, clock, blocked,
  onQueueKey, onDraft, draftLabel, canDraft,
}: PoolPaletteProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (blocked || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        const active = document.activeElement as HTMLElement | null;
        if (isTypingTarget(active)) active?.blur(); else onClose();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if ((e.key === 'q' || e.key === 'Q') && onQueueKey) { e.preventDefault(); onQueueKey(); }
      else if (e.key === 'Enter' && onDraft && canDraft) { e.preventDefault(); onDraft(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, blocked, onClose, onQueueKey, onDraft, canDraft]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-3 bg-black/55 backdrop-blur-[3px] animate-in fade-in-0 duration-150"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label="Pokemon pool"
        className="flex flex-col w-full max-w-[880px] h-[80dvh] max-h-[calc(100dvh-1.5rem)] rounded-xl border border-border-default bg-surface-raised shadow-card-lg overflow-hidden animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-start gap-2 px-3 py-2 border-b border-border-subtle">
          <div className="flex-1 min-w-0">{filters}</div>
          <div className="flex items-center gap-1 shrink-0">
            {viewControls}
            <kbd className="hidden sm:inline px-1 rounded border border-border-subtle bg-surface text-[9px] font-mono text-text-muted">Esc</kbd>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close pool"
              className="size-7 inline-flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay/50"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 gap-3 p-3">
          <div className="flex flex-col flex-1 min-w-0 min-h-0">{children}</div>
          {side}
        </div>

        <div className="flex items-center gap-3 px-3 py-2 border-t border-border-subtle text-[10px] text-text-muted">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            {onQueueKey && <Hint k="Q" label="queue" />}
            {onDraft && <Hint k="Enter" label="draft" />}
            <Hint k="Esc" label="close" />
          </div>
          <div className="flex-1" />
          {clock && <span className="font-mono tabular-nums text-sm text-text-secondary">{clock}</span>}
          {onDraft && (
            <button
              type="button"
              disabled={!canDraft}
              onClick={onDraft}
              className={cn(
                'h-8 px-3 rounded-md text-[11px] font-bold transition-all max-w-[240px] truncate',
                canDraft
                  ? 'bg-neon text-surface hover:shadow-[0_0_18px_rgba(34,211,238,0.45)]'
                  : 'bg-surface-overlay text-text-muted cursor-not-allowed',
              )}
            >
              {draftLabel ?? 'Draft'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Hint({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="px-1 rounded border border-border-subtle bg-surface text-[9px] font-mono">{k}</kbd>
      {label}
    </span>
  );
}
