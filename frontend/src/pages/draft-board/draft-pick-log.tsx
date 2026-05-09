import { useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TeamLogoSwap } from '@/components/team-logo-swap';
import { useLeague } from '@/lib/league-context';
import { pokemonRoute } from '@/lib/pokemon-route';
import { getPokemonData } from '@/data/pokemon-data';
import type { Player } from '@/lib/types';
import type { DraftPickEntry } from './types';
import type { PickEvent, AnimationPhase } from './use-pick-animation-queue';

interface DraftPickLogProps {
  picks: DraftPickEntry[];
  playerLookup: Map<string, Player>;
  /** How many recent picks to show */
  maxVisible?: number;
  /** The pick currently being celebrated by the animation queue (drives the
   *  sprite/glow/border-pulse animations on the matching log entry). */
  currentPickEvent?: PickEvent | null;
  /** Phase of the currently-celebrated pick. Animations apply only while
   *  it's in the 'landing' phase. */
  currentPhase?: AnimationPhase;
}

/** Resolve the picked Pokemon's first type → CSS var for type-tinted glow. */
function pickTypeVar(name: string): string {
  const data = getPokemonData(name);
  const t = data?.types?.[0] ?? 'normal';
  return `var(--color-type-${t})`;
}

export function DraftPickLog({
  picks, playerLookup, maxVisible = 10,
  currentPickEvent, currentPhase,
}: DraftPickLogProps) {
  const league = useLeague();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest pick
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [picks.length]);

  if (picks.length === 0) return null;

  const visible = picks.slice(-maxVisible);
  // Animations fire only while the queue's current event is in the landing
  // (or post-landing cooldown) phase. During 'flying' the sprite is mid-morph;
  // the celebration on the log entry is paired with the morph "arrival".
  const celebrate = currentPhase === 'landing' || currentPhase === 'cooldown';
  const freshOverallPick = celebrate ? currentPickEvent?.overallPick ?? null : null;

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-heading font-semibold text-text-muted uppercase tracking-wider">
          Recent Picks
        </span>
        <span className="text-[10px] font-mono text-text-muted/50">
          {picks.length} total
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1"
      >
        {visible.map((pick, i) => {
          const player = playerLookup.get(pick.playerId);
          const isLatest = i === visible.length - 1;
          const isFresh = pick.overallPick === freshOverallPick;
          const typeVar = pickTypeVar(pick.pokemonName);

          return (
            <div
              key={pick.overallPick}
              style={isFresh ? ({ ['--pick-type' as any]: typeVar }) : undefined}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md border shrink-0',
                'transition-all duration-300',
                isLatest
                  ? 'border-neon/30 bg-neon/5 shadow-[0_0_8px_rgba(34,211,238,0.1)]'
                  : 'border-border-subtle bg-surface-overlay/30',
                isFresh && 'pick-glow-burst pick-border-pulse',
              )}
            >
              {/* Pick number */}
              <span className="text-[9px] font-mono tabular-nums text-text-muted/50 w-4 text-right shrink-0">
                {pick.overallPick}
              </span>

              {/* Team pip — logo by default, hover to peek the coach's avatar */}
              {player && (
                <TeamLogoSwap
                  team={{
                    leagueId: league.id,
                    teamId: player.id,
                    teamAbbrev: player.teamAbbrev,
                    teamColor: player.teamColor,
                    logoPath: player.logoPath,
                    owner: player.owner,
                  }}
                  size="sm"
                />
              )}

              {/* Pokemon sprite — celebration on the queue's current entry only */}
              <span className={cn('inline-flex shrink-0', isFresh && 'pick-celebration')}>
                <PokemonSprite name={pick.pokemonName} size="xs" />
              </span>

              {/* Name + tier */}
              <Link
                to={pokemonRoute(pick.pokemonName)}
                className={cn(
                  'text-[10px] font-medium truncate max-w-[72px] hover:text-neon hover:underline transition-colors',
                  isLatest ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {pick.pokemonName}
              </Link>

              <span className={cn('inline-flex', isFresh && 'tier-badge-slide-in')}>
                <TierBadge points={pick.tier} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
