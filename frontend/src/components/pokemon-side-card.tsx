import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { TeamLogo } from '@/components/team-logo';
import { KDDisplay } from '@/components/kd-display';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Link } from 'react-router-dom';
import { Swords, Sparkles, X, ExternalLink } from 'lucide-react';
import { useLeagueOptional } from '@/lib/league-context';
import { getTierEntry } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import type { Player } from '@/lib/types';

interface PokemonSideCardProps {
  name: string | null;
  onClose: () => void;
  /** Optional: player who owns this Pokemon (for ownership display) */
  owner?: Player;
  /** Optional: season stats override (kills/deaths/gp) */
  seasonStats?: { kills: number; deaths: number; gp: number };
  /** Optional: tera captain info */
  teraCaptain?: { teraTypes: string[] };
}

export function PokemonSideCard({
  name,
  onClose,
  owner,
  seasonStats,
  teraCaptain,
}: PokemonSideCardProps) {
  const league = useLeagueOptional();
  const leagueUrl = (path: string) => league ? `/league/${league.id}${path.startsWith('/') ? path : `/${path}`}` : '#';
  const isOpen = !!name;

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const pokeData = name ? getPokemonData(name) : undefined;
  const tierEntry = name ? getTierEntry(name) : undefined;
  const types = pokeData?.types;
  const stats = pokeData?.stats;
  const abilities = pokeData?.abilities ?? [];
  const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]',
          'transition-opacity duration-300 ease-out',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      />

      <div
        className={cn(
          'fixed top-0 right-0 bottom-0 z-50 w-[380px]',
          'bg-surface-raised border-l border-border-default shadow-card-lg',
          'flex flex-col',
          'transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {name && (
          <>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
            >
              <X size={16} />
            </button>

            {/* Hero */}
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
                  <h2 className="text-lg font-heading font-bold text-text-primary leading-tight">
                    {name}
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

              {teraCaptain && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-pink" />
                    Tera Captain
                  </h3>
                  <div className="flex gap-1.5">
                    {teraCaptain.teraTypes.map(t => (
                      <TypeChip key={t} types={[t as any]} size="sm" />
                    ))}
                  </div>
                </div>
              )}

              {seasonStats && seasonStats.gp > 0 && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Swords size={12} className="text-neon" />
                    Season Stats
                  </h3>
                  <div className="flex items-center gap-4">
                    <KDDisplay kills={seasonStats.kills} deaths={seasonStats.deaths} />
                    <span className="text-xs text-text-muted font-mono">
                      {seasonStats.gp} GP
                    </span>
                    <span className="text-xs text-text-muted font-mono">
                      {(seasonStats.kills / Math.max(1, seasonStats.gp)).toFixed(1)} KPG
                    </span>
                  </div>
                </div>
              )}

              {owner && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                    Owner
                  </h3>
                  <div className="flex items-center gap-2.5 p-2.5 rounded-md bg-surface-overlay/30 border border-border-subtle">
                    <TeamLogo abbrev={owner.teamAbbrev} color={owner.teamColor} size="md" />
                    <div>
                      <Link
                        to={leagueUrl(`/teams/${owner.id}`)}
                        className="text-sm font-medium text-text-primary hover:text-neon transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {owner.teamName}
                      </Link>
                      <div className="text-[11px] text-text-muted">{owner.name}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Full Profile link */}
            <div className="px-6 py-3 border-t border-border-subtle">
              <Link
                to={`/pokemon/${encodeURIComponent(name)}`}
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-md text-sm font-medium text-neon hover:bg-neon/10 border border-neon/30 transition-colors"
              >
                Full Profile
                <ExternalLink size={14} />
              </Link>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
