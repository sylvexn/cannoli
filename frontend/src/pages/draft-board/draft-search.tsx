import { useRef, useState, useCallback, useId, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Search, X, Sparkles, Swords, CircleDot } from 'lucide-react';
import {
  buildSuggestions,
  hasAnySuggestion,
  type SearchChip,
  type SearchChipKind,
  type Suggestion,
} from '@/lib/pool-search';
import type { DraftFormat } from '@/data/pokemon-learnsets';

export interface DraftSearchProps {
  search: string;
  chips: SearchChip[];
  format: DraftFormat;
  onUpdate: (partial: { search?: string; searchChips?: SearchChip[] }) => void;
}

// ─── Kind metadata ──────────────────────────────────────────────────────────

const KIND_META: Record<SearchChipKind, { label: string; icon: React.ElementType; chipClass: string }> = {
  name:    { label: 'Pokemon',   icon: CircleDot, chipClass: 'border-blue-400/40 bg-blue-400/10 text-blue-300' },
  ability: { label: 'Abilities', icon: Sparkles,  chipClass: 'border-violet-400/40 bg-violet-400/10 text-violet-300' },
  move:    { label: 'Moves',     icon: Swords,    chipClass: 'border-amber-400/40 bg-amber-400/10 text-amber-300' },
};

// ─── DraftSearch ─────────────────────────────────────────────────────────────

export function DraftSearch({ search, chips, format, onUpdate }: DraftSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const listboxId = useId();

  // ── Compute suggestions whenever search text changes ──────────────────────
  const grouped = useMemo(
    () => (search.trim() ? buildSuggestions(search, format, { perGroup: 3, exclude: chips }) : null),
    [search, format, chips],
  );

  // Flatten to a single ordered list (pokemon → abilities → moves) for keyboard nav
  const flatList = useMemo<Suggestion[]>(() => {
    if (!grouped) return [];
    return [...grouped.pokemon, ...grouped.abilities, ...grouped.moves];
  }, [grouped]);

  const isOpen = open && !!grouped && hasAnySuggestion(grouped);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleTextChange = useCallback((text: string) => {
    onUpdate({ search: text });
    setOpen(true);
    setHighlightedIndex(-1);
  }, [onUpdate]);

  const commitSuggestion = useCallback((suggestion: Suggestion) => {
    onUpdate({ search: '', searchChips: [...chips, { kind: suggestion.kind, value: suggestion.value, label: suggestion.label }] });
    setOpen(false);
    setHighlightedIndex(-1);
    // Keep focus in the input
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [chips, onUpdate]);

  const removeChip = useCallback((chip: SearchChip) => {
    onUpdate({ searchChips: chips.filter(c => c !== chip) });
  }, [chips, onUpdate]);

  const clearText = useCallback(() => {
    onUpdate({ search: '' });
    setOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  }, [onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) { setOpen(true); return; }
      setHighlightedIndex(i => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && flatList[highlightedIndex]) {
        commitSuggestion(flatList[highlightedIndex]);
      } else if (flatList.length === 1) {
        // Only one match — commit it
        commitSuggestion(flatList[0]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlightedIndex(-1);
    } else if (e.key === 'Backspace' && search === '' && chips.length > 0) {
      // Remove last chip
      onUpdate({ searchChips: chips.slice(0, -1) });
    }
  }, [isOpen, highlightedIndex, flatList, search, chips, commitSuggestion, onUpdate]);

  // Compute per-group starting indices for rendering highlights
  const groupOffsets = useMemo(() => {
    const pokemonCount = grouped?.pokemon.length ?? 0;
    const abilityCount = grouped?.abilities.length ?? 0;
    return { pokemon: 0, ability: pokemonCount, move: pokemonCount + abilityCount };
  }, [grouped]);

  // Derived option id for aria-activedescendant
  const activeOptionId = highlightedIndex >= 0 ? `${listboxId}-opt-${highlightedIndex}` : undefined;

  return (
    <div className="relative flex-1 min-w-[220px] max-w-[420px]">
      {/* ── Chip + Input wrapper ─────────────────────────────────────────── */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-1 min-h-8 px-1.5 py-1',
          'bg-surface-raised border border-border-default rounded-md',
          'focus-within:border-neon/40 transition-colors',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Search icon */}
        <Search className="text-text-muted shrink-0 ml-1" size={14} aria-hidden />

        {/* Chips */}
        {chips.map((chip, i) => {
          const meta = KIND_META[chip.kind];
          const Icon = meta.icon;
          return (
            <span
              key={`${chip.kind}:${chip.value}:${i}`}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full',
                'border text-[10px] font-medium leading-none shrink-0',
                meta.chipClass,
              )}
            >
              <Icon size={9} aria-hidden />
              <span className="max-w-[100px] truncate">{chip.label}</span>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); removeChip(chip); }}
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                aria-label={`Remove ${chip.label}`}
              >
                <X size={9} />
              </button>
            </span>
          );
        })}

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={e => handleTextChange(e.target.value)}
          onFocus={() => { if (search) setOpen(true); }}
          onBlur={e => {
            // Close dropdown unless focus moved into the listbox
            if (!listboxRef.current?.contains(e.relatedTarget as Node)) {
              setOpen(false);
              setHighlightedIndex(-1);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? 'Search Pokemon, ability, or move...' : ''}
          className={cn(
            'flex-1 min-w-[80px] bg-transparent outline-none border-none',
            'text-sm text-text-primary placeholder:text-text-muted',
            'h-5 py-0',
          )}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Clear text button */}
        {search && (
          <button
            type="button"
            onClick={clearText}
            className="shrink-0 text-text-muted hover:text-text-primary transition-colors ml-0.5"
            aria-label="Clear search"
            tabIndex={-1}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* ── Suggestion dropdown ──────────────────────────────────────────── */}
      <div
        ref={listboxRef}
        id={listboxId}
        role="listbox"
        aria-label="Search suggestions"
        className={cn(
          'absolute left-0 right-0 top-full mt-1 z-50',
          'bg-surface-overlay border border-border-default rounded-md shadow-lg overflow-hidden',
          'transition-all duration-150 origin-top',
          isOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-1 pointer-events-none',
        )}
      >
        {grouped && hasAnySuggestion(grouped) && (
          <div className="py-1">
            {/* Pokemon group */}
            {grouped.pokemon.length > 0 && (
              <SuggestionGroup
                label="Pokemon"
                suggestions={grouped.pokemon}
                startIndex={groupOffsets.pokemon}
                highlightedIndex={highlightedIndex}
                listboxId={listboxId}
                onSelect={commitSuggestion}
                renderRow={s => (
                  <PokemonRow suggestion={s} />
                )}
              />
            )}

            {/* Abilities group */}
            {grouped.abilities.length > 0 && (
              <SuggestionGroup
                label="Abilities"
                suggestions={grouped.abilities}
                startIndex={groupOffsets.ability}
                highlightedIndex={highlightedIndex}
                listboxId={listboxId}
                onSelect={commitSuggestion}
                renderRow={s => (
                  <GenericRow suggestion={s} icon={Sparkles} iconClass="text-violet-400" />
                )}
              />
            )}

            {/* Moves group */}
            {grouped.moves.length > 0 && (
              <SuggestionGroup
                label="Moves"
                suggestions={grouped.moves}
                startIndex={groupOffsets.move}
                highlightedIndex={highlightedIndex}
                listboxId={listboxId}
                onSelect={commitSuggestion}
                renderRow={s => (
                  <GenericRow suggestion={s} icon={Swords} iconClass="text-amber-400" />
                )}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SuggestionGroup ─────────────────────────────────────────────────────────

interface SuggestionGroupProps {
  label: string;
  suggestions: Suggestion[];
  startIndex: number;
  highlightedIndex: number;
  listboxId: string;
  onSelect: (s: Suggestion) => void;
  renderRow: (s: Suggestion) => React.ReactNode;
}

function SuggestionGroup({
  label, suggestions, startIndex, highlightedIndex, listboxId, onSelect, renderRow,
}: SuggestionGroupProps) {
  return (
    <div>
      <div className="px-3 pt-1.5 pb-0.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
          {label}
        </span>
      </div>
      {suggestions.map((s, i) => {
        const index = startIndex + i;
        const isHighlighted = index === highlightedIndex;
        return (
          <div
            key={`${s.kind}:${s.value}`}
            id={`${listboxId}-opt-${index}`}
            role="option"
            aria-selected={isHighlighted}
            onMouseDown={e => { e.preventDefault(); onSelect(s); }}
            onMouseEnter={() => {}}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 cursor-pointer',
              'text-sm transition-colors',
              isHighlighted
                ? 'bg-neon/10 text-text-primary'
                : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary',
            )}
          >
            {renderRow(s)}
          </div>
        );
      })}
    </div>
  );
}

// ─── Row renderers ────────────────────────────────────────────────────────────

function PokemonRow({ suggestion }: { suggestion: Suggestion }) {
  return (
    <>
      <PokemonSprite name={suggestion.value} size="xs" className="shrink-0" />
      <span className="font-medium truncate">{suggestion.label}</span>
    </>
  );
}

interface GenericRowProps {
  suggestion: Suggestion;
  icon: React.ElementType;
  iconClass: string;
}

function GenericRow({ suggestion, icon: Icon, iconClass }: GenericRowProps) {
  return (
    <>
      <Icon size={12} className={cn('shrink-0', iconClass)} aria-hidden />
      <span className="font-medium truncate">{suggestion.label}</span>
    </>
  );
}
