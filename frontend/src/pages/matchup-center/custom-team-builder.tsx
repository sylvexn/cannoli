import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { rosterMonFromPokemonRow } from '@/lib/roster-from-api';
import type { RosterPokemon } from '@/lib/types';
import type { TeamSource } from './use-matchup-state';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { X, ClipboardPaste, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getMatchupColors } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { getTierEntry, DEFAULT_FORMAT, type CostFormat } from '@/data/tier-list';
import { parseShowdownPaste } from '@/lib/showdown-paste';
import { resolvePokemonByName } from '@/lib/pokemon-name-resolver';

const FORMAT_LABELS: Record<CostFormat, string> = {
  natdexplus: 'NatDex+',
  natdex: 'NatDex',
};

interface CustomTeamBuilderProps {
  side: 'a' | 'b';
  onImport: (roster: RosterPokemon[], source: TeamSource) => void;
  onClose: () => void;
}

/** Resolve a (possibly Showdown-convention) species name to a Cannoli row
 *  via the shared name resolver, converted to RosterPokemon */
async function lookupPokemon(name: string): Promise<RosterPokemon | null> {
  const data = await resolvePokemonByName(name, api.getPokemonByName);
  return data ? rosterMonFromPokemonRow(data) : null;
}

export function CustomTeamBuilder({ side, onImport, onClose }: CustomTeamBuilderProps) {
  const [slots, setSlots] = useState<(RosterPokemon | null)[]>(Array(12).fill(null));
  const [pasteText, setPasteText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ name: string; tier: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [addingToSlot, setAddingToSlot] = useState<number | null>(null);
  // Matchup center is league-independent, so we expose a lightweight format
  // toggle. Tier badges in search results are resolved from the bundled tier
  // list for the selected format rather than the format-agnostic API tier.
  const [tierFormat, setTierFormat] = useState<CostFormat>(DEFAULT_FORMAT);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { colorblindMode } = useAuth();
  const matchupColors = getMatchupColors(colorblindMode);

  const filledCount = slots.filter(Boolean).length;

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await api.getPokemonList({ search: searchQuery, limit: 20 });
        setSearchResults(results.map(p => ({ name: p.name, tier: p.tier })));
      } catch {
        setSearchResults([]);
      }
      setSearchLoading(false);
    }, 250);
    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery]);

  async function handlePasteImport() {
    if (!pasteText.trim()) return;
    setImporting(true);
    const names = parseShowdownPaste(pasteText);
    if (names.length === 0) {
      toast.error('No Pokemon found in paste');
      setImporting(false);
      return;
    }

    const results = await Promise.all(names.slice(0, 12).map(lookupPokemon));
    const newSlots = [...slots];
    let added = 0;
    for (const mon of results) {
      if (!mon) continue;
      // Find first empty slot
      const emptyIdx = newSlots.findIndex(s => s === null);
      if (emptyIdx === -1) break;
      newSlots[emptyIdx] = mon;
      added++;
    }
    setSlots(newSlots);
    setPasteText('');
    toast.success(`Imported ${added} Pokemon`);
    if (results.some(r => r === null)) {
      const failed = names.filter((_, i) => !results[i]);
      toast.warning(`Could not find: ${failed.join(', ')}`);
    }
    setImporting(false);
  }

  async function handleAddFromSearch(name: string) {
    const targetSlot = addingToSlot ?? slots.findIndex(s => s === null);
    if (targetSlot === -1 || targetSlot >= 12) {
      toast.error('All slots full');
      return;
    }

    const mon = await lookupPokemon(name);
    if (!mon) {
      toast.error(`Pokemon "${name}" not found`);
      return;
    }

    const newSlots = [...slots];
    newSlots[targetSlot] = mon;
    setSlots(newSlots);
    setAddingToSlot(null);
    setSearchQuery('');
    setSearchResults([]);
  }

  function handleRemoveSlot(idx: number) {
    const newSlots = [...slots];
    newSlots[idx] = null;
    setSlots(newSlots);
  }

  function handleConfirm() {
    const roster = slots.filter(Boolean) as RosterPokemon[];
    if (roster.length === 0) {
      toast.error('Add at least one Pokemon');
      return;
    }
    onImport(roster, { type: 'custom', label: `Custom (${roster.length})` });
  }

  const borderColor = side === 'a' ? 'border-[#3b82f6]/20' : 'border-[#ef4444]/20';
  const accentColor = side === 'a' ? matchupColors.sideA : matchupColors.sideB;

  return (
    <div className={cn('rounded-lg border bg-surface-raised p-3 space-y-3', borderColor)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accentColor }}>
          Custom Team ({filledCount}/12)
        </h3>
        <div className="flex items-center gap-2 ml-auto">
          {/* Format selector — affects tier badge display in search results */}
          <div className="flex items-center gap-px rounded border border-border-subtle overflow-hidden">
            {(['natdexplus', 'natdex'] as CostFormat[]).map(f => (
              <button
                key={f}
                onClick={() => setTierFormat(f)}
                className={cn(
                  'px-2 py-0.5 text-[9px] font-medium transition-colors',
                  tierFormat === f
                    ? 'bg-surface-overlay text-text-primary'
                    : 'text-text-muted hover:bg-surface-overlay/40 hover:text-text-secondary',
                )}
                title={`Show tiers for ${FORMAT_LABELS[f]}`}
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
          <button
            onClick={handleConfirm}
            disabled={filledCount === 0}
            className="text-[10px] font-semibold px-2.5 py-1 rounded bg-neon/10 text-neon border border-neon/20 hover:bg-neon/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Use Team
          </button>
          <button onClick={onClose} className="text-text-muted hover:text-loss transition-colors p-0.5">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Paste import */}
      <div className="space-y-1.5">
        <textarea
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          placeholder="Paste Showdown / PokePaste team export here..."
          className="w-full h-20 rounded-md bg-surface text-xs font-mono border border-border-subtle px-2.5 py-2 resize-none focus:outline-none focus:border-neon/40 placeholder:text-text-muted"
        />
        <button
          onClick={handlePasteImport}
          disabled={!pasteText.trim() || importing}
          className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded bg-surface-overlay text-text-secondary hover:text-text-primary border border-border-subtle hover:border-border-default transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ClipboardPaste size={11} />
          {importing ? 'Importing...' : 'Import Paste'}
        </button>
      </div>

      {/* Slots grid */}
      <div className="grid grid-cols-6 gap-1.5">
        {slots.map((mon, i) => (
          <div
            key={i}
            className={cn(
              'relative rounded-md border aspect-square flex items-center justify-center transition-colors',
              mon
                ? 'border-border-default bg-surface-overlay/30'
                : addingToSlot === i
                  ? 'border-neon/40 bg-neon/5'
                  : 'border-border-subtle border-dashed hover:border-border-default cursor-pointer',
            )}
            onClick={() => {
              if (!mon) setAddingToSlot(addingToSlot === i ? null : i);
            }}
          >
            {mon ? (
              <>
                <PokemonSprite name={mon.name} size="sm" />
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveSlot(i); }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-surface-raised border border-border-default flex items-center justify-center text-text-muted hover:text-loss hover:border-loss/30 transition-colors"
                >
                  <X size={8} />
                </button>
                <span className="absolute bottom-0 left-0 right-0 text-[7px] font-mono text-text-muted text-center truncate px-0.5">
                  {mon.name}
                </span>
              </>
            ) : (
              <Plus size={12} className="text-text-muted/30" />
            )}
          </div>
        ))}
      </div>

      {/* Search to add Pokemon */}
      {addingToSlot !== null && (
        <div className="space-y-1">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search Pokemon..."
              autoFocus
              className="w-full pl-7 pr-2 py-1.5 rounded-md bg-surface text-xs border border-border-subtle focus:outline-none focus:border-neon/40"
            />
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-md bg-surface border border-border-subtle">
              {searchResults.map(p => {
                // Resolve tier from bundled data for the selected format; fall
                // back to API tier if the bundled entry isn't found (e.g. new
                // mons not yet in the local tier list).
                const bundledEntry = getTierEntry(p.name, tierFormat);
                const displayTier = bundledEntry?.tier ?? (p.tier > 0 ? p.tier : null);
                return (
                  <button
                    key={p.name}
                    onClick={() => handleAddFromSearch(p.name)}
                    className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-overlay/50 transition-colors"
                  >
                    <PokemonSprite name={p.name} size="xs" className="shrink-0" />
                    <span className="text-[11px] text-text-primary flex-1 truncate">{p.name}</span>
                    {displayTier != null && (
                      <span className="text-[9px] text-text-muted font-mono" title={FORMAT_LABELS[tierFormat]}>
                        T{displayTier}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {searchLoading && <div className="text-[10px] text-text-muted">Searching...</div>}
        </div>
      )}
    </div>
  );
}
