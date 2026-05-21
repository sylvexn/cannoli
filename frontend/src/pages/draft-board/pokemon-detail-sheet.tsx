import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { TeamLink } from '@/components/team-link';
import { useLeague } from '@/lib/league-context';
import { KDDisplay } from '@/components/kd-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Swords, Sparkles, X } from 'lucide-react';
import { useLeagueUrl } from '@/lib/use-league-url';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { RosterPokemon, Player } from '@/lib/types';
import type { PoolOwnership } from './types';
import { getTierEntry } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';

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
  const leagueUrl = useLeagueUrl();
  const league = useLeague();
  const isOpen = !!name;

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Resolve data (safe even when name is null — we just won't render content)
  const mon = name ? rosterLookup.get(name) : undefined;
  const pokeData = name ? getPokemonData(name) : undefined;
  const ownership = name ? ownershipMap.get(name) : undefined;
  const owner = ownership ? playerLookup.get(ownership.teamId) : undefined;
  const tierEntry = name ? getTierEntry(name) : undefined;
  const types = mon?.types ?? pokeData?.types;
  const stats = mon?.stats ?? pokeData?.stats;
  const abilities = mon?.abilities ?? pokeData?.abilities ?? [];
  const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]',
          'transition-opacity duration-300 ease-out',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      />

      {/* Panel — always mounted, slides via transform */}
      <div
        className={cn(
          'fixed top-0 right-0 bottom-0 z-50 w-[400px]',
          'bg-surface-raised border-l border-border-default shadow-card-lg',
          'flex flex-col',
          'transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {name && (
          <>
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
            >
              <X size={16} />
            </button>

            {/* Hero section */}
            <div className="relative px-6 pt-6 pb-4">
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
                  <h2 className="text-lg font-heading font-bold leading-tight">
                    <Link to={pokemonRoute(name)} className="text-text-primary hover:text-neon hover:underline transition-colors">
                      {name}
                    </Link>
                  </h2>

                  <div className="flex items-center gap-2 mt-1.5">
                    {tierEntry && <TierBadge points={tierEntry.tier} />}
                    {types && <TypeChip types={types} size="sm" />}
                  </div>

                  {bst && (
                    <div className="text-xs text-text-muted font-mono mt-1">BST {bst}</div>
                  )}

                  {tierEntry && (
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
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
              {stats && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                    Base Stats
                  </h3>
                  <div className="space-y-1">
                    <StatBar label="HP" value={stats.hp} />
                    <StatBar label="Atk" value={stats.atk} />
                    <StatBar label="Def" value={stats.def} />
                    <StatBar label="SpA" value={stats.spa} />
                    <StatBar label="SpD" value={stats.spd} />
                    <StatBar label="Spe" value={stats.spe} />
                  </div>
                </div>
              )}

              {abilities.length > 0 && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                    Abilities
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {abilities.map(a => (
                      <AbilityChip key={a} name={a} />
                    ))}
                  </div>
                </div>
              )}

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

              {owner && ownership && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                    Ownership
                  </h3>
                  <div className="flex items-center gap-2.5 p-2.5 rounded-md bg-surface-overlay/30 border border-border-subtle">
                    <TeamLink
                      team={{
                        leagueId: league.id,
                        teamId: owner.id,
                        teamName: owner.teamName,
                        teamAbbrev: owner.teamAbbrev,
                        teamColor: owner.teamColor,
                        record: owner.record,
                      }}
                      logoOnly
                      logoSize="md"
                    />
                    <div>
                      <Link
                        to={leagueUrl(`/teams/${owner.id}`)}
                        className="text-sm font-medium text-text-primary hover:text-neon transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {owner.teamName}
                      </Link>
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

              {!owner && (
                <div className="p-3 rounded-md bg-surface-overlay/30 border border-border-subtle text-center">
                  <span className="text-xs text-text-muted">Free Agent — not on any roster</span>
                </div>
              )}
            </div>

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
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
