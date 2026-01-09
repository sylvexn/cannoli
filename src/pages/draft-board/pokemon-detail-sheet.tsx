import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { TeamLogo } from '@/components/team-logo';
import { KDDisplay } from '@/components/kd-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ArrowRightLeft, Swords, Sparkles } from 'lucide-react';
import type { RosterPokemon, Player } from '@/lib/types';
import type { PoolOwnership } from './types';
import { getTierEntry } from '@/mocks/tier-list';

interface PokemonDetailSheetProps {
  name: string | null;
  onClose: () => void;
  rosterLookup: Map<string, RosterPokemon>;
  ownershipMap: Map<string, PoolOwnership>;
  playerLookup: Map<string, Player>;
  canDraft?: boolean;
  onDraft?: (name: string) => void;
}

export function PokemonDetailSheet({
  name,
  onClose,
  rosterLookup,
  ownershipMap,
  playerLookup,
  canDraft,
  onDraft,
}: PokemonDetailSheetProps) {
  if (!name) return null;

  const mon = rosterLookup.get(name);
  const ownership = ownershipMap.get(name);
  const owner = ownership ? playerLookup.get(ownership.teamId) : undefined;
  const tierEntry = getTierEntry(name);
  const bst = mon ? mon.stats.hp + mon.stats.atk + mon.stats.def + mon.stats.spa + mon.stats.spd + mon.stats.spe : null;

  return (
    <Sheet open={!!name} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[400px] bg-surface-raised border-border-default p-0 flex flex-col">
        {/* Hero section */}
        <div className="relative px-6 pt-6 pb-4">
          {/* Background accent */}
          {owner && (
            <div
              className="absolute inset-0 opacity-[0.06]"
              style={{ background: `radial-gradient(ellipse at top right, ${owner.teamColor}, transparent 70%)` }}
            />
          )}

          <div className="relative flex items-start gap-4">
            <div className="flex-shrink-0 rounded-lg bg-surface-overlay/50 p-2">
              <PokemonSprite name={name} size="xl" />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <SheetHeader className="p-0 space-y-0">
                <SheetTitle className="text-lg font-heading font-bold text-text-primary leading-tight">
                  {name}
                </SheetTitle>
              </SheetHeader>

              <div className="flex items-center gap-2 mt-1.5">
                {tierEntry && <TierBadge points={tierEntry.tier} />}
                {mon && <TypeChip types={mon.types} size="sm" />}
              </div>

              {bst && (
                <div className="text-xs text-text-muted font-mono mt-1">BST {bst}</div>
              )}

              {tierEntry && (
                <div className="flex items-center gap-1.5 mt-2">
                  <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 border-border-subtle text-text-muted font-mono">
                    Cost: {tierEntry.tier}pt
                  </Badge>
                  {tierEntry.teraCost !== tierEntry.tier && (
                    <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 border-pink/30 text-pink font-mono">
                      Tera: {tierEntry.teraCost}pt
                    </Badge>
                  )}
                  {tierEntry.teraBanned && (
                    <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 border-loss/30 text-loss">
                      Tera banned
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <Separator className="bg-border-subtle" />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Stats */}
          {mon && (
            <div>
              <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Base Stats
              </h3>
              <div className="space-y-1">
                <StatBar label="HP" value={mon.stats.hp} />
                <StatBar label="Atk" value={mon.stats.atk} />
                <StatBar label="Def" value={mon.stats.def} />
                <StatBar label="SpA" value={mon.stats.spa} />
                <StatBar label="SpD" value={mon.stats.spd} />
                <StatBar label="Spe" value={mon.stats.spe} />
              </div>
            </div>
          )}

          {/* Abilities */}
          {mon && mon.abilities.length > 0 && (
            <div>
              <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Abilities
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {mon.abilities.map(a => (
                  <AbilityChip key={a} name={a} />
                ))}
              </div>
            </div>
          )}

          {/* Tera captain info */}
          {mon?.isTeraCaptain && mon.teraTypes && (
            <div>
              <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles size={12} className="text-pink" />
                Tera Captain
              </h3>
              <div className="flex gap-1.5">
                {mon.teraTypes.map(t => (
                  <TypeChip key={t} types={[t]} size="sm" />
                ))}
              </div>
            </div>
          )}

          {/* Season stats */}
          {mon?.seasonStats && (
            <div>
              <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Swords size={12} className="text-neon" />
                Season Stats
              </h3>
              <div className="flex items-center gap-4">
                <KDDisplay kills={mon.seasonStats.kills} deaths={mon.seasonStats.deaths} />
                <span className="text-xs text-text-muted font-mono">
                  {mon.seasonStats.gp} GP
                </span>
                <span className="text-xs text-text-muted font-mono">
                  {(mon.seasonStats.kills / Math.max(1, mon.seasonStats.gp)).toFixed(1)} KPG
                </span>
              </div>
            </div>
          )}

          {/* Ownership info */}
          {owner && ownership && (
            <div>
              <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Ownership
              </h3>
              <div className="flex items-center gap-2.5 p-2.5 rounded-md bg-surface-overlay/30 border border-border-subtle">
                <TeamLogo abbrev={owner.teamAbbrev} color={owner.teamColor} size="md" />
                <div>
                  <div className="text-sm font-medium text-text-primary">{owner.teamName}</div>
                  <div className="text-[11px] text-text-muted">
                    {ownership.acquisition.method === 'traded' ? (
                      <span className="flex items-center gap-1">
                        <ArrowRightLeft size={10} className="text-pink" />
                        Traded from {playerLookup.get(ownership.acquisition.fromTeamId!)?.teamAbbrev ?? '?'}
                        {ownership.acquisition.week && ` · Week ${ownership.acquisition.week}`}
                      </span>
                    ) : (
                      <span>
                        Drafted · Round {ownership.acquisition.round}, Pick {ownership.acquisition.pick}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Free agent notice */}
          {!owner && (
            <div className="p-3 rounded-md bg-surface-overlay/30 border border-border-subtle text-center">
              <span className="text-xs text-text-muted">Free Agent — not on any roster</span>
            </div>
          )}
        </div>

        {/* Draft button (live mode only) */}
        {canDraft && onDraft && (
          <div className="p-4 border-t border-border-default">
            <Button
              onClick={() => { onDraft(name); onClose(); }}
              className="w-full bg-neon hover:bg-neon/90 text-surface font-bold"
            >
              <Sparkles size={14} className="mr-2" />
              Draft {name}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
