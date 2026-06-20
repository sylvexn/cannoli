/**
 * Reusable sub-editors for the structured per-league rules editor.
 *
 *  - StringListEditor — an ordered list over `string[]` (add / edit / remove /
 *    reorder). Used for Draft Rules and Battle Rules (long sentences → textarea).
 *  - PairListEditor    — an ordered list of two-field rows (add / edit / remove /
 *    reorder). Used for Clauses (name + description) and Pokémon bans
 *    (pokemon + move).
 *  - ChipEditor        — a tag/chip editor over `string[]` (add via Enter or the
 *    Add button, remove per-chip). Used for banned abilities / items / moves and
 *    tera-captain bans. Order isn't meaningful for these.
 *
 * All three are controlled — they own no state, just call `onChange` with the
 * next array. Keep them dumb so the parent's single dirty baseline stays
 * authoritative.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Trash2, Plus, ArrowUp, ArrowDown, X } from 'lucide-react';

const textareaClass =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-text-primary ' +
  'placeholder:text-text-muted leading-relaxed outline-none transition-colors ' +
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y';

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Small vertical reorder + remove control column shared by the list editors. */
function RowControls({
  index,
  count,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number;
  count: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onMoveUp}
        disabled={index === 0}
        aria-label="Move up"
        className="text-text-muted hover:text-text-primary"
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onMoveDown}
        disabled={index === count - 1}
        aria-label="Move down"
        className="text-text-muted hover:text-text-primary"
      >
        <ArrowDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        aria-label="Remove row"
        className="text-text-muted hover:text-loss"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/* ─────────────────────────── StringListEditor ─────────────────────────── */

export function StringListEditor({
  items,
  onChange,
  placeholder,
  addLabel = 'Add rule',
  rows = 2,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-[11px] text-text-muted italic">No entries yet.</p>
      )}
      {items.map((value, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="pt-2 w-5 text-right shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
            {i + 1}
          </span>
          <textarea
            value={value}
            rows={rows}
            placeholder={placeholder}
            onChange={(e) => {
              const next = items.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
            className={textareaClass}
            spellCheck
          />
          <RowControls
            index={i}
            count={items.length}
            onMoveUp={() => onChange(move(items, i, i - 1))}
            onMoveDown={() => onChange(move(items, i, i + 1))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange([...items, ''])}
        className="h-7 gap-1.5 text-[11px] text-neon hover:text-neon"
      >
        <Plus size={13} />
        {addLabel}
      </Button>
    </div>
  );
}

/* ──────────────────────────── PairListEditor ──────────────────────────── */

export interface PairItem {
  a: string;
  b: string;
}

export function PairListEditor({
  items,
  onChange,
  labelA,
  labelB,
  placeholderA,
  placeholderB,
  addLabel = 'Add row',
  /** Render the `b` field as a textarea (e.g. clause descriptions) vs. input. */
  bMultiline = false,
}: {
  items: PairItem[];
  onChange: (next: PairItem[]) => void;
  labelA: string;
  labelB: string;
  placeholderA?: string;
  placeholderB?: string;
  addLabel?: string;
  bMultiline?: boolean;
}) {
  function patch(i: number, key: keyof PairItem, value: string) {
    const next = items.slice();
    next[i] = { ...next[i], [key]: value };
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-[11px] text-text-muted italic">No entries yet.</p>
      )}
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-raised p-2"
        >
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <div className="space-y-1">
              <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted">
                {labelA}
              </label>
              <Input
                value={item.a}
                placeholder={placeholderA}
                onChange={(e) => patch(i, 'a', e.target.value)}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted">
                {labelB}
              </label>
              {bMultiline ? (
                <textarea
                  value={item.b}
                  rows={2}
                  placeholder={placeholderB}
                  onChange={(e) => patch(i, 'b', e.target.value)}
                  className={cn(textareaClass, 'text-xs')}
                  spellCheck
                />
              ) : (
                <Input
                  value={item.b}
                  placeholder={placeholderB}
                  onChange={(e) => patch(i, 'b', e.target.value)}
                  className="h-7 text-xs"
                />
              )}
            </div>
          </div>
          <RowControls
            index={i}
            count={items.length}
            onMoveUp={() => onChange(move(items, i, i - 1))}
            onMoveDown={() => onChange(move(items, i, i + 1))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange([...items, { a: '', b: '' }])}
        className="h-7 gap-1.5 text-[11px] text-neon hover:text-neon"
      >
        <Plus size={13} />
        {addLabel}
      </Button>
    </div>
  );
}

/* ────────────────────────────── ChipEditor ────────────────────────────── */

export function ChipEditor({
  items,
  onChange,
  placeholder = 'Type and press Enter…',
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (!value) return;
    if (!items.some((x) => x.toLowerCase() === value.toLowerCase())) {
      onChange([...items, value]);
    }
    setDraft('');
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="h-7 text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={add}
          disabled={!draft.trim()}
          className="h-7 gap-1.5 text-[11px] text-neon hover:text-neon shrink-0"
        >
          <Plus size={13} />
          Add
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-text-muted italic">No entries yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((value, i) => (
            <span
              key={`${value}-${i}`}
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-overlay pl-2 pr-1 py-0.5 text-[11px] text-text-secondary"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remove ${value}`}
                className="text-text-muted hover:text-loss transition-colors"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
