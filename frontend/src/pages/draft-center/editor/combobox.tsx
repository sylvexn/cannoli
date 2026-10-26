import { useState, type ReactNode } from 'react';
import { ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

/**
 * Searchable single-select (Popover + cmdk). Keyboard: Enter/Space/arrows open the trigger,
 * type to filter, arrows + Enter pick, Esc closes. A typed value not in `options` can still be
 * used ("Use ..."), so a missing entry is never a dead end.
 */
export function Combobox({ value, options, onChange, placeholder, label, leading, invalid, className }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  leading?: ReactNode;
  invalid?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim();
  const custom = q && !options.some(o => o.toLowerCase() === q.toLowerCase());
  const pick = (v: string) => { onChange(v); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQuery(''); }}>
      <div className={cn('relative min-w-0', className)}>
        <PopoverTrigger
          aria-label={label}
          className={cn(
            'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-transparent pl-2 text-left text-xs transition-colors hover:bg-surface-overlay/40',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none',
            value ? 'pr-12' : 'pr-6',
            invalid && 'border-amber-400/60',
          )}
        >
          {leading}
          <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
        </PopoverTrigger>
        <ChevronsUpDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-50" />
        {value && (
          <button
            type="button" aria-label={`Clear ${label}`} onClick={() => onChange('')}
            className="absolute right-5 top-1/2 -translate-y-1/2 size-6 rounded flex items-center justify-center text-text-muted hover:text-text-primary"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <PopoverContent className="w-64 max-w-[calc(100vw-1rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            {custom && (
              <CommandItem value={`__custom ${q}`} forceMount onSelect={() => pick(q)}>Use &quot;{q}&quot;</CommandItem>
            )}
            {options.map(o => (
              <CommandItem key={o} value={o} onSelect={() => pick(o)} data-checked={o === value ? 'true' : undefined}>{o}</CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
