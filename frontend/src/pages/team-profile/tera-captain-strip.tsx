import { useState } from 'react';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import { POKEMON_TYPES } from '@/lib/pokemon';
import { TYPE_COLORS, TYPE_ABBR } from '@/lib/constants';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { getTermCost, canBeTeraCaptain, DEFAULT_FORMAT, type CostFormat } from '@/data/tier-list';
import { Save, X, ChevronDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';

interface TeraCaptainStripProps {
  activeRoster: RosterPokemon[];
  captainCount: number;
  config: { teraCaptainSlots: number; pointCap: number };
  theorycraftMode: boolean;
  /** Whether the user can edit tera captains (theorycraft mode OR admin) */
  canEdit: boolean;
  /**
   * Current season phase. Captain edits are server-locked once the phase is
   * regular/playoffs/offseason — strip surfaces this with a disabled Save button
   * and a "Captains lock at draft end" tooltip while still letting users see
   * what's currently designated.
   */
  seasonPhase?: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason' | null;
  teraEdits: { name: string; isTeraCaptain: boolean; teraTypes: PokemonType[] }[];
  teraEditingIndex: number | null;
  pointsUsed: number;
  playerId: string;
  /** League cost format — drives tera-ban eligibility checks. Defaults to natdexplus. */
  costFormat?: CostFormat;
  onTeraEditingIndexChange: (index: number | null) => void;
  onToggleCaptain: (index: number) => void;
  onTeraTypeToggle: (index: number, type: PokemonType) => void;
  onTeraEditsClear: () => void;
}

export function TeraCaptainStrip({
  activeRoster,
  captainCount,
  config,
  theorycraftMode,
  canEdit,
  seasonPhase,
  teraEdits,
  teraEditingIndex,
  pointsUsed,
  playerId,
  costFormat = DEFAULT_FORMAT,
  onTeraEditingIndexChange,
  onToggleCaptain,
  onTeraTypeToggle,
  onTeraEditsClear,
}: TeraCaptainStripProps) {
  const [addPickerOpen, setAddPickerOpen] = useState(false);

  // Tera captains (and their tera types) are freely editable at any point in the
  // season per league rules — the backend no longer phase-locks
  // PUT /api/teams/:teamId/tera-captains. The only server-side stop is an
  // archived team, surfaced via the save's error toast. (seasonPhase retained in
  // props for callers; intentionally no longer gates editing.)
  void seasonPhase;
  const captainsLocked = false;

  const captains = activeRoster
    .map((mon, i) => ({ mon, index: i }))
    .filter(({ mon }) => mon.isTeraCaptain);

  const hasCaptains = captains.length > 0;
  const showStrip = canEdit || hasCaptains;
  const canAddMore = captainCount < config.teraCaptainSlots;

  // Eligible pokemon for adding as captain
  const eligible = activeRoster
    .map((mon, i) => ({ mon, index: i }))
    .filter(({ mon }) => {
      if (mon.isTeraCaptain) return false;
      if (!canBeTeraCaptain(mon.name, costFormat)) return false;
      const costDelta = getTermCost(mon.tier) - mon.tier;
      if (pointsUsed + costDelta > config.pointCap) return false;
      return true;
    });

  if (!showStrip) return null;

  async function handleSave() {
    const caps = activeRoster
      .filter(m => m.isTeraCaptain)
      .map(m => ({ pokemonName: m.name, teraTypes: (m.teraTypes ?? []) as string[] }));
    try {
      const result = await api.saveTerraCaptains(playerId, caps) as {
        success: boolean;
        captainsLocked?: boolean;
        phaseAdvanced?: boolean;
      };
      if (result.phaseAdvanced) {
        toast.success('Captains locked — league advanced to regular season!');
      } else if (result.captainsLocked) {
        toast.success('Captains locked. Waiting on remaining teams to advance the league.');
      } else {
        toast.success('Tera captains saved');
      }
      onTeraEditsClear();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Failed to save'));
    }
  }

  return (
    <div className="px-4 py-3 border-t border-pink/10 bg-pink/[0.02]">
      {/* Header */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 18 18" className="shrink-0">
            <circle cx="9" cy="9" r="8.5" fill="#e879f9" />
            <path d="M9 3 L13.5 7.5 L9 15 L4.5 7.5 Z" fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" opacity="0.9" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-wider text-pink">
            Tera Captains
          </span>
          <span className={cn(
            'text-[10px] font-mono tabular-nums',
            captainCount > config.teraCaptainSlots ? 'text-loss' : 'text-text-muted',
          )}>
            {captainCount}/{config.teraCaptainSlots}
          </span>
        </div>
        {canEdit && !theorycraftMode && teraEdits.length > 0 && (
          <button
            onClick={handleSave}
            disabled={captainsLocked}
            title={captainsLocked ? 'Captains lock at draft end' : undefined}
            className={cn(
              'flex items-center gap-1 text-[10px] font-semibold transition-colors px-2 py-0.5 rounded',
              captainsLocked
                ? 'text-text-muted/50 bg-surface-overlay/30 border border-border-subtle cursor-not-allowed'
                : 'text-neon hover:text-neon/80 bg-neon/5 border border-neon/20',
            )}
          >
            <Save size={11} />
            {captainsLocked ? 'Locked' : 'Save'}
          </button>
        )}
        {canEdit && !theorycraftMode && captainsLocked && teraEdits.length === 0 && (
          <span
            className="text-[9px] uppercase tracking-wider text-text-muted/60 font-semibold"
            title="Captains lock at draft end"
          >
            Locked
          </span>
        )}
      </div>

      {/* Captain cards — centered */}
      <div className="flex flex-wrap justify-center gap-2">
        {captains.map(({ mon, index: capIdx }) => {
          const isEditing = teraEditingIndex === capIdx;
          const types = mon.teraTypes ?? [];
          return (
            <div
              key={`cap-${capIdx}`}
              className={cn(
                'rounded-lg border transition-all w-full max-w-[280px]',
                isEditing ? 'border-pink/30 bg-pink/5' : 'border-border-subtle bg-surface-overlay/30',
              )}
            >
              {/* Captain info row */}
              <div className="flex items-center gap-2.5 px-3 py-2">
                <PokemonSprite name={mon.name} size="sm" shiny={mon.isShiny} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-text-primary truncate">{mon.name}</div>
                  {mon.nickname && (
                    <div className="text-[10px] italic text-text-muted truncate font-mono" title={mon.nickname}>
                      "{mon.nickname}"
                    </div>
                  )}
                  <div className="text-[10px] text-text-muted">
                    {getTermCost(mon.tier)}pt
                    <span className="text-text-muted/40 ml-1">(base {mon.tier})</span>
                  </div>
                </div>

                {/* Tera type chips — clickable to open editor */}
                <button
                  onClick={() => {
                    if (canEdit) onTeraEditingIndexChange(isEditing ? null : capIdx);
                  }}
                  className={cn(
                    'flex items-center gap-1 px-1 py-0.5 rounded transition-colors',
                    canEdit && 'hover:bg-pink/10 cursor-pointer',
                    !canEdit && 'cursor-default',
                  )}
                >
                  {types.length > 0 ? types.map(t => (
                    <span
                      key={t}
                      className="text-[8px] font-bold uppercase text-white rounded px-1.5 py-0.5"
                      style={{ backgroundColor: TYPE_COLORS[t] }}
                    >
                      {TYPE_ABBR[t]}
                    </span>
                  )) : (
                    <span className="text-[9px] text-pink/40 italic">No types</span>
                  )}
                  {canEdit && (
                    <ChevronDown size={10} className={cn(
                      'text-pink/40 transition-transform ml-0.5',
                      isEditing && 'rotate-180',
                    )} />
                  )}
                </button>

                {/* Remove button */}
                {canEdit && (
                  <button
                    onClick={() => onToggleCaptain(capIdx)}
                    className="p-1 rounded hover:bg-loss/10 text-text-muted/40 hover:text-loss transition-colors"
                    title="Remove captain"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Inline type picker */}
              {isEditing && canEdit && (
                <div className="px-3 pb-2.5 pt-1.5 border-t border-pink/10">
                  <div className="text-[9px] text-pink/60 font-semibold uppercase tracking-wider mb-1.5">
                    Select up to 3 types
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {POKEMON_TYPES.map(type => {
                      const isSelected = types.includes(type);
                      const atMax = types.length >= 3 && !isSelected;
                      return (
                        <button
                          key={type}
                          disabled={atMax}
                          onClick={() => onTeraTypeToggle(capIdx, type)}
                          className={cn(
                            'text-[8px] font-bold uppercase rounded px-1.5 py-0.5 transition-all',
                            isSelected
                              ? 'text-white ring-1 ring-white/30 scale-105'
                              : atMax
                                ? 'text-white/20 opacity-20 cursor-not-allowed'
                                : 'text-white/50 opacity-40 hover:opacity-80',
                          )}
                          style={{ backgroundColor: TYPE_COLORS[type] }}
                        >
                          {TYPE_ABBR[type]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add captain button */}
        {canEdit && canAddMore && (
          <div className="relative w-full max-w-[280px]">
            <button
              onClick={() => setAddPickerOpen(!addPickerOpen)}
              className={cn(
                'w-full rounded-lg border border-dashed flex items-center justify-center gap-1.5 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                addPickerOpen
                  ? 'border-pink/30 bg-pink/5 text-pink'
                  : 'border-pink/20 text-pink/40 hover:border-pink/30 hover:text-pink/60',
              )}
            >
              <Plus size={12} />
              Add Captain
            </button>

            {/* Eligible picker dropdown */}
            {addPickerOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 z-40 rounded-lg bg-surface-raised border border-pink/20 shadow-lg max-h-48 overflow-y-auto">
                {eligible.length === 0 ? (
                  <div className="px-3 py-3 text-[10px] text-text-muted text-center">
                    No eligible Pokemon (tier 1-9, not tera-banned, within point cap)
                  </div>
                ) : (
                  eligible.map(({ mon, index: eligIdx }) => {
                    const costDelta = getTermCost(mon.tier) - mon.tier;
                    return (
                      <button
                        key={eligIdx}
                        onClick={() => {
                          onToggleCaptain(eligIdx);
                          setAddPickerOpen(false);
                          onTeraEditingIndexChange(eligIdx);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-pink/5 transition-colors text-left"
                      >
                        <PokemonSprite name={mon.name} size="xs" shiny={mon.isShiny} className="shrink-0" />
                        <span className="text-[11px] text-text-primary font-medium flex-1 truncate">{mon.name}</span>
                        <span className="text-[10px] text-text-muted font-mono">T{mon.tier}</span>
                        {costDelta > 0 && (
                          <span className="text-[9px] text-pink font-mono">+{costDelta}</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
