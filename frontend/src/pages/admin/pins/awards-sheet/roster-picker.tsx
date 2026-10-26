/** Pokemon picker limited to one team's roster (sprite + name). */
import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { cn } from '@/lib/utils';

export function RosterPicker({
  roster, value, onChange, clearable, invalid,
}: {
  roster: string[];
  value?: string;
  onChange: (name: string | undefined) => void;
  /** Show a clear (X) button - used where an empty pick means "no award". */
  clearable?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // A saved Pokemon may have left the roster (trade/drop); keep it selectable.
  const options = value && !roster.includes(value) ? [value, ...roster] : roster;
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            'inline-flex items-center gap-1 h-7 min-w-[8.5rem] max-w-[11rem] rounded-md border bg-surface-raised px-1.5 text-xs transition-colors hover:bg-surface-overlay/40',
            invalid ? 'border-loss' : 'border-border-default',
          )}
        >
          {value ? <PokemonSprite name={value} size="xs" /> : null}
          <span className={cn('flex-1 min-w-0 truncate text-left', !value && 'text-text-muted')}>
            {value ?? 'Pick Pokemon'}
          </span>
          <ChevronDown size={11} className="shrink-0 text-text-muted" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-full max-w-[220px] p-1 max-h-[min(20rem,60dvh)] overflow-y-auto">
          {options.length === 0 && <div className="px-2 py-1.5 text-[11px] text-text-muted">Empty roster</div>}
          {options.map(name => (
            <button
              key={name}
              type="button"
              onClick={() => { onChange(name); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-surface-overlay/60',
                name === value && 'bg-surface-overlay/40',
              )}
            >
              <PokemonSprite name={name} size="xs" />
              <span className="truncate">{name}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted hover:text-loss"
          title="Clear"
          aria-label="Clear Pokemon"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
