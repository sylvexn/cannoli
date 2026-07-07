import { useMemo, useState } from 'react';
import { ShieldAlert, X, Plus, Undo2, AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { Player, RosterPokemon, LeagueConfig, LeagueSeason } from '@/lib/types';
import { getTermCost, getBanned, type CostFormat } from '@/data/tier-list';
import { isMegaForm, getBaseFormName } from '@/lib/draft-rules';
import { rosterPointsUsed, teraCaptainCount } from '@/lib/roster';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { PokemonLink } from '@/components/pokemon-link';
import { TierBadge } from '@/components/tier-badge';
import { PointCapBarLarge } from '@/components/point-cap-bar';
import { AddPicker } from './theorycraft-mode';
import { computePool } from './utils';

interface RosterOverrideModalProps {
  player: Player;
  leagueId: string;
  players: Player[];
  costFormat: CostFormat;
  config: LeagueConfig;
  season: LeagueSeason | null | undefined;
  onClose: () => void;
  onCommitted: () => void;
}

/**
 * Effective point cost of a roster entry (tera-captain markup folded in).
 * Mirrors rosterPointsUsed's per-mon rule so the row badges agree with the meter.
 */
function effectiveCost(mon: RosterPokemon): number {
  return mon.isTeraCaptain ? getTermCost(mon.tier) : mon.tier;
}

/**
 * Client-side ADVISORY warnings for the projected roster. These never block the
 * commit — the server re-validates authoritatively and returns its own set. The
 * duplicate National-Dex check can't run here (the client has no natdex numbers),
 * so it's called out in the panel and enforced server-side only.
 */
function computeSoftWarnings(
  roster: RosterPokemon[],
  config: LeagueConfig,
  season: LeagueSeason | null | undefined,
  costFormat: CostFormat,
): string[] {
  const issues: string[] = [];

  // Point cap (effective, incl. captain markup)
  const total = rosterPointsUsed(roster);
  if (total > config.pointCap) {
    issues.push(`Over point cap — ${total}/${config.pointCap}pt (+${total - config.pointCap})`);
  }

  // Roster band (falls back to the flat rosterSize when min/max unset)
  const effMax = season?.maxRosterSize ?? season?.rosterSize ?? null;
  const effMin = season?.minRosterSize ?? season?.rosterSize ?? null;
  if (effMax != null && roster.length > effMax) {
    issues.push(`Roster has ${roster.length} Pokemon (max ${effMax})`);
  }
  if (effMin != null && roster.length < effMin) {
    issues.push(`Roster has ${roster.length} Pokemon (min ${effMin})`);
  }

  // Mega cap — max 1 per team
  const megas = roster.filter(m => isMegaForm(m.name));
  if (megas.length > 1) {
    issues.push(`${megas.length} megas (${megas.map(m => m.name).join(', ')}) — max 1`);
  }

  // Duplicate species (base-form proxy for the natdex check)
  const seen = new Map<string, string>();
  for (const m of roster) {
    const base = getBaseFormName(m.name);
    const prev = seen.get(base);
    if (prev && prev !== m.name) {
      issues.push(`Duplicate species: ${prev} + ${m.name}`);
    }
    seen.set(base, m.name);
  }

  // Banned / illegal
  const banned = new Set(getBanned(costFormat));
  for (const m of roster) {
    if (banned.has(m.name)) issues.push(`${m.name} is banned in this format`);
  }

  // Tera captain slots
  const caps = teraCaptainCount(roster);
  if (caps > config.teraCaptainSlots) {
    issues.push(`${caps} tera captains (max ${config.teraCaptainSlots})`);
  }

  return issues;
}

export function RosterOverrideModal({
  player,
  leagueId,
  players,
  costFormat,
  config,
  season,
  onClose,
  onCommitted,
}: RosterOverrideModalProps): React.JSX.Element {
  // leagueId is part of the contract (scoping/analytics) but the override endpoint
  // is keyed on teamId; kept in the signature for symmetry with the page.
  void leagueId;

  const base = player.roster;
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [additions, setAdditions] = useState<RosterPokemon[]>([]);
  const [addingMode, setAddingMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const pool = useMemo(() => computePool(players, costFormat), [players, costFormat]);

  // Projected roster = base − removed + additions.
  const projected = useMemo(() => {
    const kept = base.filter(m => typeof m.rosterId !== 'number' || !removedIds.has(m.rosterId));
    return [...kept, ...additions];
  }, [base, removedIds, additions]);

  const pointsUsed = rosterPointsUsed(projected);
  const originalPoints = rosterPointsUsed(base);
  const pointsDelta = pointsUsed - originalPoints;
  const captainCount = teraCaptainCount(projected);

  const warnings = useMemo(
    () => computeSoftWarnings(projected, config, season, costFormat),
    [projected, config, season, costFormat],
  );

  const hasChanges = additions.length > 0 || removedIds.size > 0;

  function toggleRemove(rosterId: number) {
    setRemovedIds(prev => {
      const next = new Set(prev);
      if (next.has(rosterId)) next.delete(rosterId);
      else next.add(rosterId);
      return next;
    });
  }

  function handleAdd(mon: RosterPokemon) {
    setAdditions(prev => (prev.some(m => m.name === mon.name) ? prev : [...prev, mon]));
  }

  function removeAddition(name: string) {
    setAdditions(prev => prev.filter(m => m.name !== name));
  }

  function handleOpenChange(open: boolean) {
    if (!open && !saving) onClose();
  }

  async function handleCommit() {
    setSaving(true);
    try {
      const removeRosterIds = [...removedIds];
      const add = additions.map(a => ({ name: a.name }));
      const res = await api.adminOverrideRoster(player.id, { add, removeRosterIds });
      toast.success(
        `Override applied — ${res.added.length} added, ${res.removed.length} removed`,
      );
      if (res.warnings.length > 0) {
        toast.warning('Committed with warnings', {
          duration: 10000,
          description: (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {res.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ),
        });
      }
      onCommitted();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Override failed'));
      // Leave the modal open so the admin can retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88dvh] flex flex-col gap-3">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-mono uppercase tracking-wide flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-400 shrink-0" />
            Override {player.teamAbbrev || player.teamName}
          </DialogTitle>
          <p className="text-xs text-text-muted">
            Staff free-reign roster edit — add or remove any Pokemon. Warnings are
            advisory; the commit is never blocked.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <PointCapBarLarge used={pointsUsed} total={config.pointCap} className="flex-1" />
            <span className="text-[11px] font-mono tabular-nums text-text-secondary shrink-0">
              {pointsUsed}/{config.pointCap}pt
            </span>
            <span className="text-[10px] font-mono tabular-nums text-text-muted shrink-0">
              {projected.length} mon
            </span>
            <span className="text-[10px] font-mono tabular-nums text-pink shrink-0">
              Tera {captainCount}/{config.teraCaptainSlots}
            </span>
          </div>
        </DialogHeader>

        {/* Soft-warnings panel */}
        {warnings.length > 0 ? (
          <div className="shrink-0 max-h-[22dvh] overflow-y-auto rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              <AlertTriangle className="size-3.5 shrink-0" />
              {warnings.length} warning{warnings.length === 1 ? '' : 's'} — commit still allowed
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-text-secondary">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-amber-400/70">•</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="shrink-0 rounded-lg border border-border-subtle bg-surface-overlay/20 px-3 py-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
            <Check className="size-3.5 text-win shrink-0" />
            No client-side rule issues detected.
          </div>
        )}
        <p className="shrink-0 -mt-1 text-[10px] text-text-muted">
          Duplicate National-Dex numbers are validated on the server (not shown here).
        </p>

        {/* Body: roster/additions scroller on top; when the picker is open it
            fills the space below with its own internal scroll — no nested
            double-scroll, footer stays pinned. */}
        <div className="flex-1 min-h-0 flex flex-col gap-1.5">
          {/* Current roster + additions — own scroll region. Takes the whole
              body when the picker is closed; caps + scrolls to yield room to
              the picker when it's open. */}
          <div
            className={cn(
              '-mx-1 px-1 flex flex-col gap-1.5 overflow-y-auto min-h-0',
              // When the picker is open, cap the roster so the picker (flex-1)
              // keeps a usable height — tighter on phones where vertical budget
              // is scarce, roomier on desktop.
              addingMode ? 'shrink-0 max-h-[22dvh] sm:max-h-[30dvh]' : 'flex-1',
            )}
          >
          {/* Current roster — remove toggles */}
          <div className="text-[9px] font-semibold uppercase tracking-widest text-text-muted px-0.5">
            Current roster
          </div>
          {base.map((mon, i) => {
            const hasId = typeof mon.rosterId === 'number' && Number.isFinite(mon.rosterId);
            const marked = hasId && removedIds.has(mon.rosterId as number);
            return (
              <div
                key={mon.rosterId ?? `base-${i}`}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors',
                  marked
                    ? 'border-loss/30 bg-loss/[0.05] opacity-60'
                    : 'border-border-subtle bg-surface-overlay/20',
                )}
              >
                <PokemonSprite name={mon.name} size="md" shiny={!!mon.isShiny} className="shrink-0" />
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  <PokemonLink
                    name={mon.name}
                    format={costFormat}
                    className={cn(
                      'text-sm font-semibold truncate hover:text-neon transition-colors',
                      marked ? 'text-text-muted line-through' : 'text-text-primary',
                    )}
                  />
                  <TierBadge points={effectiveCost(mon)} className="shrink-0" />
                  {mon.isTeraCaptain && (
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-pink shrink-0">
                      Cap
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!hasId}
                  title={
                    !hasId
                      ? 'No roster id — cannot remove'
                      : marked
                        ? 'Undo removal'
                        : 'Mark for removal'
                  }
                  onClick={() => hasId && toggleRemove(mon.rosterId as number)}
                  className={cn('shrink-0', marked ? 'text-neon' : 'text-text-muted hover:text-loss')}
                >
                  {marked ? <Undo2 className="size-4" /> : <X className="size-4" />}
                </Button>
              </div>
            );
          })}

          {/* Additions */}
          {additions.length > 0 && (
            <div className="mt-1 text-[9px] font-semibold uppercase tracking-widest text-win px-0.5">
              Adding ({additions.length})
            </div>
          )}
          {additions.map(mon => (
            <div
              key={`add-${mon.name}`}
              className="flex items-center gap-2.5 rounded-lg border border-win/30 bg-win/[0.05] px-2.5 py-1.5"
            >
              <PokemonSprite name={mon.name} size="md" className="shrink-0" />
              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <PokemonLink
                  name={mon.name}
                  format={costFormat}
                  className="text-sm font-semibold text-text-primary truncate hover:text-neon transition-colors"
                />
                <TierBadge points={effectiveCost(mon)} className="shrink-0" />
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-win shrink-0">
                  New
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Remove addition"
                onClick={() => removeAddition(mon.name)}
                className="shrink-0 text-text-muted hover:text-loss"
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}

          </div>

          {/* Add toggle */}
          <button
            type="button"
            onClick={() => setAddingMode(v => !v)}
            className={cn(
              'shrink-0 flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-[11px] font-semibold uppercase tracking-wider transition-all',
              addingMode
                ? 'border-neon/50 bg-neon/5 text-neon'
                : 'border-border-subtle text-text-muted hover:border-neon/40 hover:text-neon',
            )}
          >
            <Plus className="size-4" />
            {addingMode ? 'Close picker' : 'Add Pokemon'}
          </button>

          {/* Reused AddPicker — free reign (over-cap stays pickable). Drafted mons
              are reachable via its "Show taken" toggle with a "drafted by" hint.
              `fill` lets it flex to the remaining body height with one internal
              scroll instead of a fixed 320px block nested inside another scroll. */}
          {addingMode && (
            <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border-subtle overflow-hidden">
              <AddPicker
                activeRoster={projected}
                pool={pool}
                pointsUsed={pointsUsed}
                config={config}
                allowOverCap
                fill
                onAdd={handleAdd}
                onClose={() => setAddingMode(false)}
              />
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
            <span className="text-text-muted">
              +{additions.length} / -{removedIds.size}
            </span>
            {pointsDelta !== 0 && (
              <span className={pointsDelta > 0 ? 'text-loss' : 'text-win'}>
                {pointsDelta > 0 ? '+' : ''}
                {pointsDelta}pt
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              <X className="size-4" />
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !hasChanges}
              onClick={() => void handleCommit()}
            >
              {saving ? 'Committing…' : 'Commit override'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
