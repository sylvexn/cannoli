import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { getTierEntry, type CostFormat } from '@/data/tier-list';

interface PaletteSideProps {
  pointCap: number;
  pointsLeft: number;
  slotsLeft: number;
  /** Highest tier takeable right now (after reserving for remaining picks). */
  maxNow: number | undefined;
  queue: string[];
  autoDraft: boolean;
  roster: { name: string; tier: number }[];
  format: CostFormat;
  onQueueRemove: (name: string) => void;
  onQueueReorder: (queue: string[]) => void;
  onToggleAuto: () => void;
  onOpenPokemon: (name: string) => void;
}

/** Palette right column: your budget, your queue, your team. */
export function PaletteSide({
  pointCap, pointsLeft, slotsLeft, maxNow, queue, autoDraft, roster, format,
  onQueueRemove, onQueueReorder, onToggleAuto, onOpenPokemon,
}: PaletteSideProps) {
  const pct = Math.max(0, Math.min(100, (pointsLeft / Math.max(1, pointCap)) * 100));
  const low = slotsLeft > 0 && pointsLeft / slotsLeft <= 2;

  const move = (i: number, d: -1 | 1) => {
    const next = [...queue];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onQueueReorder(next);
  };

  return (
    <div className="w-[230px] shrink-0 hidden md:flex flex-col gap-3 overflow-y-auto border-l border-border-subtle pl-3 min-h-0">
      <section>
        <Label>Budget</Label>
        <div className="flex items-baseline gap-1 font-mono">
          <span className={cn('text-xl font-bold tabular-nums', low ? 'text-loss' : 'text-text-primary')}>{pointsLeft}</span>
          <span className="text-[11px] text-text-muted">/ {pointCap} pts left</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-surface-overlay overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon to-pink transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] font-mono text-text-muted">
          {slotsLeft} slot{slotsLeft === 1 ? '' : 's'}
          {maxNow != null && <> · max now <span className="text-text-primary font-bold">{maxNow}</span></>}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <Label>Queue</Label>
          <span className="text-[9px] font-mono text-text-muted/70">{queue.length}/3</span>
        </div>
        {queue.length === 0 ? (
          <p className="text-[10px] text-text-muted leading-snug">Hover a Pokemon and press Q to queue it.</p>
        ) : (
          <div className="space-y-0.5">
            {queue.map((name, i) => {
              const entry = getTierEntry(name, format);
              return (
                <div key={name} className="flex items-center gap-1 py-0.5 pl-1 pr-0.5 rounded bg-pink/5 border border-pink/15">
                  <span className="text-[9px] font-mono text-pink/70 w-2.5 text-right shrink-0">{i + 1}</span>
                  <PokemonSprite name={name} size="xs" />
                  <button
                    type="button"
                    onClick={() => onOpenPokemon(name)}
                    className="flex-1 min-w-0 truncate text-left text-[11px] text-text-primary hover:text-neon"
                  >
                    {name}
                  </button>
                  {entry && <TierBadge points={entry.tier} />}
                  <div className="flex flex-col shrink-0">
                    <IconBtn label={`Move ${name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={10} /></IconBtn>
                    <IconBtn label={`Move ${name} down`} disabled={i === queue.length - 1} onClick={() => move(i, 1)}><ChevronDown size={10} /></IconBtn>
                  </div>
                  <IconBtn label={`Remove ${name} from queue`} onClick={() => onQueueRemove(name)} className="hover:text-loss h-5 w-5">
                    <X size={11} />
                  </IconBtn>
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={onToggleAuto}
          aria-pressed={autoDraft}
          className={cn(
            'mt-1.5 w-full flex items-center gap-2 px-2 py-1 rounded-md border text-[10px] transition-colors',
            autoDraft ? 'bg-pink/10 border-pink/30 text-pink' : 'bg-surface-overlay/30 border-border-subtle text-text-muted hover:text-text-secondary',
          )}
        >
          <span className={cn('w-6 h-3.5 rounded-full relative shrink-0', autoDraft ? 'bg-pink' : 'bg-surface-overlay')}>
            <span className={cn('absolute top-0.5 size-2.5 rounded-full bg-white transition-all', autoDraft ? 'left-3' : 'left-0.5')} />
          </span>
          <span className="text-left leading-tight">Auto-pick #1 if clock runs out</span>
        </button>
      </section>

      <section className="min-h-0">
        <div className="flex items-center justify-between">
          <Label>My team</Label>
          <span className="text-[9px] font-mono text-text-muted/70">{roster.length}</span>
        </div>
        {roster.length === 0 ? (
          <p className="text-[10px] text-text-muted">No picks yet.</p>
        ) : (
          <div className="space-y-0.5">
            {roster.map(r => (
              <button
                key={r.name}
                type="button"
                onClick={() => onOpenPokemon(r.name)}
                className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-surface-overlay/50 text-left"
              >
                <PokemonSprite name={r.name} size="xs" />
                <span className="flex-1 min-w-0 truncate text-[11px] text-text-primary">{r.name}</span>
                <TierBadge points={r.tier} />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] font-heading font-semibold uppercase tracking-wider text-text-muted">{children}</div>;
}

function IconBtn({ label, onClick, disabled, className, children }: {
  label: string; onClick: () => void; disabled?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('h-3 w-5 inline-flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-25', className)}
    >
      {children}
    </button>
  );
}
