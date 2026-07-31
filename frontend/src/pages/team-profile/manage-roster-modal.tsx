import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Player, LeagueConfig, LeagueSeason } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import { POKEMON_TYPES } from '@/lib/pokemon';
import { TYPE_COLORS, TYPE_ABBR } from '@/lib/constants';
import { getTermCost, canBeTeraCaptain } from '@/data/tier-list';
import type { CostFormat } from '@/data/tier-list';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { isStaff } from '@/lib/permissions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { PointCapBarLarge } from '@/components/point-cap-bar';

const NICKNAME_MAX = 40;

/** Small filled gem mirroring the tera-captain treatment used elsewhere. */
function TeraGem({ className }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 18 18" className={cn('shrink-0', className)}>
      <path d="M9 1.5 L16.5 7 L9 16.5 L1.5 7 Z" fill="currentColor" />
    </svg>
  );
}

/** Order-insensitive equality for two tera-type lists. */
function sameTypes(a: PokemonType[], b: PokemonType[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(t => set.has(t));
}

export function ManageRosterModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: Player;
  config: LeagueConfig;
  costFormat: CostFormat;
  season: LeagueSeason | null | undefined;
  onSaved: () => void | Promise<void>;
}): React.JSX.Element {
  const { open, onOpenChange, player, config, costFormat, onSaved } = props;
  // season is part of the contract but not needed for the current edit flow.
  void props.season;

  const { user } = useAuth();
  // Once captains are locked, a coach can no longer apply tera changes directly
  // — they REQUEST the change for admin approval (feedback #51). Staff always
  // apply directly; an owner whose captains aren't locked is still in the
  // initial captain-gate setup and saves directly.
  const teraNeedsApproval = !isStaff(user) && !!player.captainsLocked;

  // Frozen snapshot of the roster captured when the modal opens.
  const roster = player.roster;

  const [nicknames, setNicknames] = useState<string[]>([]);
  const [shiny, setShiny] = useState<boolean[]>([]);
  const [captain, setCaptain] = useState<boolean[]>([]);
  const [teraTypes, setTeraTypes] = useState<PokemonType[][]>([]);
  const [saving, setSaving] = useState(false);

  // Re-initialize local edit state from player.roster every time we open.
  useEffect(() => {
    if (!open) return;
    setNicknames(roster.map(m => m.nickname ?? ''));
    setShiny(roster.map(m => !!m.isShiny));
    setCaptain(roster.map(m => !!m.isTeraCaptain));
    setTeraTypes(roster.map(m => m.teraTypes ?? []));
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Derived values
  const pointsUsed = roster.reduce(
    (sum, mon, i) => sum + (captain[i] ? getTermCost(mon.tier) : mon.tier),
    0,
  );
  const originalPointsUsed = roster.reduce(
    (sum, mon) => sum + (mon.isTeraCaptain ? getTermCost(mon.tier) : mon.tier),
    0,
  );
  const captainCount = captain.filter(Boolean).length;
  const overSlots = captainCount > config.teraCaptainSlots;
  const pointDelta = pointsUsed - originalPointsUsed;

  function captainEligibility(i: number): { eligible: boolean; reason?: string } {
    const mon = roster[i];
    if (!canBeTeraCaptain(mon.name, costFormat)) {
      return { eligible: false, reason: 'Not eligible to be a tera captain' };
    }
    if (captainCount >= config.teraCaptainSlots) {
      return { eligible: false, reason: `All ${config.teraCaptainSlots} captain slots are full` };
    }
    const projected = pointsUsed - mon.tier + getTermCost(mon.tier);
    if (projected > config.pointCap) {
      return { eligible: false, reason: 'Captain markup would exceed the point cap' };
    }
    return { eligible: true };
  }

  function setNicknameAt(i: number, value: string) {
    setNicknames(prev => {
      const next = [...prev];
      next[i] = value.slice(0, NICKNAME_MAX);
      return next;
    });
  }

  function toggleShinyAt(i: number) {
    setShiny(prev => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  }

  function toggleCaptainAt(i: number) {
    setCaptain(prev => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  }

  function toggleTeraType(i: number, type: PokemonType) {
    setTeraTypes(prev => {
      const next = prev.map(arr => [...arr]);
      const list = next[i];
      const idx = list.indexOf(type);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else if (list.length < 3) {
        list.push(type);
      }
      return next;
    });
  }

  // Save
  async function handleSave() {
    setSaving(true);
    try {
      const writes: Promise<unknown>[] = [];

      // 1. Nicknames — only rows with a real rosterId whose trimmed value changed.
      roster.forEach((mon, i) => {
        if (typeof mon.rosterId !== 'number' || !Number.isFinite(mon.rosterId)) return;
        const trimmed = nicknames[i].trim();
        const original = mon.nickname ?? '';
        if (trimmed !== original) {
          writes.push(api.setRosterNickname(player.id, mon.rosterId, trimmed || null));
        }
      });

      // 2. Shiny — only flipped rows.
      roster.forEach((mon, i) => {
        if (shiny[i] !== !!mon.isShiny) {
          writes.push(api.toggleShiny(player.id, mon.name, shiny[i]));
        }
      });

      // 3. Captains — recompute if membership or any captain's types changed.
      const captainsChanged = roster.some((mon, i) => {
        if (captain[i] !== !!mon.isTeraCaptain) return true;
        if (captain[i]) return !sameTypes(teraTypes[i], mon.teraTypes ?? []);
        return false;
      });

      const totalDiffs = writes.length + (captainsChanged ? 1 : 0);
      if (totalDiffs === 0) {
        onOpenChange(false);
        return;
      }

      let captainSuccessToast = false;
      await Promise.all(writes);

      if (captainsChanged) {
        const captains = roster
          .map((mon, i) => ({ mon, i }))
          .filter(x => captain[x.i])
          .map(x => ({ pokemonName: x.mon.name, teraTypes: teraTypes[x.i] as string[] }));

        if (teraNeedsApproval) {
          // Captains are locked: file a request for admin approval instead of
          // applying. Nothing changes on the roster until an admin approves.
          await api.requestTeraChange(player.id, captains);
          toast.success('Tera change submitted for admin approval');
          captainSuccessToast = true;
        } else {
          const result = (await api.saveTerraCaptains(player.id, captains)) as {
            phaseAdvanced?: boolean;
            captainsLocked?: boolean;
          };
          if (result.phaseAdvanced) {
            toast.success('Captains locked — league advanced to regular season!');
            captainSuccessToast = true;
          } else if (result.captainsLocked) {
            toast.success('Captains locked. Waiting on remaining teams to advance the league.');
            captainSuccessToast = true;
          }
        }
      }

      if (!captainSuccessToast) toast.success('Roster updated');
      await onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Failed to save roster'));
      // Leave the modal open so they can retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85dvh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-wide">
            Manage {player.teamAbbrev || player.teamName}
          </DialogTitle>
          <p className="text-xs text-text-muted">Nicknames, shinies &amp; tera captains</p>
          <div className="flex items-center gap-3 pt-1">
            <PointCapBarLarge used={pointsUsed} total={config.pointCap} className="flex-1" />
            <span className="text-[11px] font-mono tabular-nums text-text-secondary shrink-0">
              {pointsUsed}/{config.pointCap}pt
            </span>
            <span
              className={cn(
                'flex items-center gap-1 text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded shrink-0',
                overSlots ? 'text-loss bg-loss/10' : 'text-pink bg-pink/10',
              )}
            >
              <TeraGem className={overSlots ? 'text-loss' : 'text-pink'} />
              Tera {captainCount}/{config.teraCaptainSlots}
            </span>
          </div>
          {teraNeedsApproval && (
            <p className="text-[11px] text-draw mt-1">
              Captains are locked — tera captain changes are submitted to an admin
              for approval. Nicknames and shinies still save instantly.
            </p>
          )}
        </DialogHeader>

        {/* Scrollable roster body */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1 flex flex-col gap-1.5">
          {roster.map((mon, i) => {
            const isCaptain = captain[i];
            const effectiveCost = isCaptain ? getTermCost(mon.tier) : mon.tier;
            const elig = captainEligibility(i);
            const captainDisabled = !isCaptain && !elig.eligible;
            const types = teraTypes[i] ?? [];

            return (
              <div
                key={i}
                className={cn(
                  'rounded-lg border transition-colors',
                  isCaptain
                    ? 'border-pink/30 bg-pink/[0.04]'
                    : 'border-border-subtle bg-surface-overlay/20',
                )}
              >
                <div className="flex items-center gap-2.5 px-2.5 py-2">
                  {/* Sprite with shiny badge overlay */}
                  <div className="relative shrink-0">
                    <PokemonSprite name={mon.name} size="md" shiny={shiny[i]} className="shrink-0" />
                    {shiny[i] && (
                      <span
                        title="Shiny"
                        className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-yellow-500/90 ring-1 ring-surface-base shadow"
                      >
                        <Sparkles className="size-2.5 text-white" />
                      </span>
                    )}
                  </div>

                  {/* Name + cost */}
                  <div className="min-w-0 shrink basis-20 sm:basis-[150px]">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'text-sm font-semibold truncate',
                          isCaptain ? 'text-pink' : 'text-text-primary',
                        )}
                        title={mon.name}
                      >
                        {mon.name}
                      </span>
                      <TierBadge points={effectiveCost} className="shrink-0" />
                    </div>
                    {isCaptain && (
                      <span className="text-[10px] font-mono text-text-muted">
                        (base {mon.tier})
                      </span>
                    )}
                  </div>

                  {/* Nickname input */}
                  <input
                    value={nicknames[i] ?? ''}
                    onChange={e => setNicknameAt(i, e.target.value)}
                    placeholder={mon.name}
                    maxLength={NICKNAME_MAX}
                    aria-label={`Nickname for ${mon.name}`}
                    className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />

                  {/* Shiny toggle */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-pressed={shiny[i]}
                    title={shiny[i] ? 'Shiny on' : 'Mark shiny'}
                    onClick={() => toggleShinyAt(i)}
                    className={cn(
                      'shrink-0',
                      shiny[i]
                        ? 'text-yellow-400 bg-yellow-500/20 hover:bg-yellow-500/30'
                        : 'text-text-muted',
                    )}
                  >
                    <Sparkles className="size-4" />
                  </Button>

                  {/* Captain toggle */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-pressed={isCaptain}
                    disabled={captainDisabled}
                    title={
                      isCaptain
                        ? 'Remove tera captain'
                        : elig.eligible
                          ? 'Make tera captain'
                          : elig.reason
                    }
                    onClick={() => toggleCaptainAt(i)}
                    className={cn(
                      'shrink-0',
                      isCaptain
                        ? 'text-pink bg-pink/15 hover:bg-pink/25'
                        : 'text-text-muted',
                    )}
                  >
                    <TeraGem />
                  </Button>
                </div>

                {/* Tera type chip selector — only when captain */}
                {isCaptain && (
                  <div className="px-2.5 pb-2.5 pt-0.5 border-t border-pink/10">
                    <div className="text-[9px] text-pink/60 font-semibold uppercase tracking-wider mb-1.5">
                      Select up to 3 types
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {POKEMON_TYPES.map(type => {
                        const selected = types.includes(type);
                        const atMax = types.length >= 3 && !selected;
                        return (
                          <button
                            key={type}
                            type="button"
                            disabled={atMax}
                            onClick={() => toggleTeraType(i, type)}
                            className={cn(
                              'text-[8px] font-bold uppercase rounded px-1.5 py-0.5 transition-all',
                              selected
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
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <div className="text-xs font-mono tabular-nums">
            {pointDelta !== 0 && (
              <span className={pointDelta > 0 ? 'text-loss' : 'text-win'}>
                {pointDelta > 0 ? '+' : ''}
                {pointDelta}pt
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
