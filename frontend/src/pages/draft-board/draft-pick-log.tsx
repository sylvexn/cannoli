import { useRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TeamLogo } from '@/components/team-logo';
import { pokemonRoute } from '@/lib/pokemon-route';
import { getPokemonData } from '@/data/pokemon-data';
import type { Player } from '@/lib/types';
import type { DraftPickEntry } from './types';

interface DraftPickLogProps {
  picks: DraftPickEntry[];
  playerLookup: Map<string, Player>;
  /** How many recent picks to show */
  maxVisible?: number;
}

const CELEBRATION_MS = 1200;

/** Resolve the picked Pokemon's first type → CSS var for type-tinted glow. */
function pickTypeVar(name: string): string {
  const data = getPokemonData(name);
  const t = data?.types?.[0] ?? 'normal';
  return `var(--color-type-${t})`;
}

export function DraftPickLog({ picks, playerLookup, maxVisible = 10 }: DraftPickLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track which pick numbers were added since this component mounted, so we
  // only run the celebration sequence on truly fresh picks (not on initial
  // hydration from existing state). Each entry is removed after 1.2s.
  const [freshPicks, setFreshPicks] = useState<Set<number>>(() => new Set());
  const seenRef = useRef<Set<number>>(new Set());
  // Mark all picks present at mount as "already seen" — they pre-date the
  // user opening the pick log and should not animate.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    for (const p of picks) seenRef.current.add(p.overallPick);
  }, [picks]);

  useEffect(() => {
    if (!mountedRef.current) return;
    const newOnes: number[] = [];
    for (const p of picks) {
      if (!seenRef.current.has(p.overallPick)) {
        seenRef.current.add(p.overallPick);
        newOnes.push(p.overallPick);
      }
    }
    if (newOnes.length === 0) return;
    setFreshPicks(prev => {
      const next = new Set(prev);
      for (const n of newOnes) next.add(n);
      return next;
    });
    const timers = newOnes.map(n => setTimeout(() => {
      setFreshPicks(prev => {
        if (!prev.has(n)) return prev;
        const next = new Set(prev);
        next.delete(n);
        return next;
      });
    }, CELEBRATION_MS));
    return () => { for (const t of timers) clearTimeout(t); };
  }, [picks]);

  // Auto-scroll to latest pick
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [picks.length]);

  if (picks.length === 0) return null;

  const visible = picks.slice(-maxVisible);

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
          const isFresh = freshPicks.has(pick.overallPick);
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

              {/* Team pip */}
              {player && (
                <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
              )}

              {/* Pokemon sprite — celebration on fresh entries only */}
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
