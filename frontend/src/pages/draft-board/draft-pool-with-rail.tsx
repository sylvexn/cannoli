import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, Lock, Target } from 'lucide-react';
import type { TierEntry } from '@/data/tier-list';
import type { RosterPokemon, Player } from '@/lib/types';
import type { PoolOwnership } from './types';
import type { ConflictInputRoster } from '@/lib/draft-rules';
import { DraftPoolGrid } from './draft-pool-grid';
import type { CardDensity } from './pokemon-compact-card';

interface DraftPoolWithRailProps {
  poolByTier: [number, TierEntry[]][];
  ownershipMap: Map<string, PoolOwnership>;
  playerLookup: Map<string, Player>;
  rosterLookup: Map<string, RosterPokemon>;
  selectedTeamId: string | null;
  isUserPickable?: boolean;
  showTierBadges?: boolean;
  /** Highest tier the user can take right now after reserving for remaining picks + captain markup */
  userMaxAffordableCost?: number;
  userConflictRoster?: ConflictInputRoster;
  /** Conflict context for whoever is currently on the clock. Drives card-level
   *  dim/disable for illegal picks (mega-cap, dup species, over budget) so all
   *  viewers see the same legality picture as the drafter. */
  drafterConflictRoster?: ConflictInputRoster;
  /** Highest tier the current drafter can take right now (mirrors userMaxAffordableCost). */
  drafterMaxAffordableCost?: number;
  pointCap?: number;
  draftQueue?: string[];
  /** Card layout density — threaded through to DraftPoolGrid */
  density?: CardDensity;
  /** Pokemon currently mid-flight in the pick animation queue — threaded through */
  animatingPokemonName?: string | null;
  onCardClick: (name: string) => void;
  onCardHoverStart: (name: string, rect: DOMRect) => void;
  onCardHoverEnd: () => void;
}

/**
 * Pool grid wrapped with a left-edge tier rail.
 *
 * The rail mirrors the tiers present in the pool, with:
 *   - active-tier highlight (scroll position aware)
 *   - click-to-jump
 *   - keyboard navigation: Arrow Up/Down, Home/End, Enter/Space (the rail
 *     itself is a vertical `tablist` with each tier as a `tab`)
 *   - per-tier affordability bar (only when budget context is supplied)
 *   - "best in budget" marker — highest tier with at least one affordable free
 *     agent. Lives outside the tablist with its own aria-label.
 *
 * Falls back to a plain grid (no rail) when there's no budget context — i.e.,
 * season mode, where the rail wouldn't add navigation value.
 */
export function DraftPoolWithRail(props: DraftPoolWithRailProps) {
  const {
    poolByTier, ownershipMap, userMaxAffordableCost, showTierBadges,
  } = props;

  const showRail = showTierBadges && poolByTier.length > 1;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tierRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const tabButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [activeTier, setActiveTier] = useState<number>(poolByTier[0]?.[0] ?? 20);

  // Observe which tier is currently at the top of the scroll viewport
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !showRail) return;
    const onScroll = () => {
      const scrollerRect = scroller.getBoundingClientRect();
      const targetY = scrollerRect.top + 60;
      let closest: number | null = null;
      let closestDist = Infinity;
      for (const [tier, el] of tierRefs.current.entries()) {
        const elRect = el.getBoundingClientRect();
        const dist = Math.abs(elRect.top - targetY);
        if (dist < closestDist) {
          closestDist = dist;
          closest = tier;
        }
      }
      if (closest != null) setActiveTier(closest);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [showRail, poolByTier]);

  const tierStats = useMemo(() => {
    const stats = new Map<number, { total: number; affordable: number; owned: number }>();
    for (const [tier, entries] of poolByTier) {
      const owned = entries.filter(e => ownershipMap.has(e.name)).length;
      const affordable = userMaxAffordableCost != null
        ? entries.filter(e => !ownershipMap.has(e.name) && tier <= userMaxAffordableCost).length
        : 0;
      stats.set(tier, { total: entries.length, affordable, owned });
    }
    return stats;
  }, [poolByTier, ownershipMap, userMaxAffordableCost]);

  const bestInBudgetTier = useMemo(() => {
    if (!showRail || userMaxAffordableCost == null) return null;
    for (const [tier] of poolByTier) {
      const s = tierStats.get(tier);
      if (s && s.affordable > 0) return tier;
    }
    return null;
  }, [showRail, poolByTier, tierStats, userMaxAffordableCost]);

  const jumpToTier = useCallback((tier: number) => {
    const el = tierRefs.current.get(tier);
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    scroller.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  }, []);

  // Keyboard navigation across the tier tablist
  const tiers = useMemo(() => poolByTier.map(([t]) => t), [poolByTier]);
  const focusTab = useCallback((tier: number) => {
    const btn = tabButtonRefs.current.get(tier);
    if (btn) btn.focus();
    setActiveTier(tier);
    jumpToTier(tier);
  }, [jumpToTier]);

  const onTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, tier: number) => {
    const idx = tiers.indexOf(tier);
    if (idx === -1) return;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = tiers[Math.min(tiers.length - 1, idx + 1)];
        focusTab(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = tiers[Math.max(0, idx - 1)];
        focusTab(prev);
        break;
      }
      case 'Home': {
        e.preventDefault();
        focusTab(tiers[0]);
        break;
      }
      case 'End': {
        e.preventDefault();
        focusTab(tiers[tiers.length - 1]);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        jumpToTier(tier);
        break;
      }
    }
  }, [tiers, focusTab, jumpToTier]);

  if (!showRail) {
    return (
      <div className="flex-1 overflow-y-auto rounded-lg border border-border-default bg-surface-raised/50 min-w-0 min-h-0">
        <DraftPoolGrid {...props} />
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-lg border border-border-default bg-surface-raised/50 min-w-0 min-h-0 flex overflow-hidden">
      {/* Tier rail */}
      <div className="w-[52px] shrink-0 border-r border-border-subtle bg-surface-raised/30 flex flex-col items-center py-2 gap-0.5 overflow-y-auto">
        {bestInBudgetTier != null && (
          <button
            onClick={() => jumpToTier(bestInBudgetTier)}
            className={cn(
              'mb-1 w-[44px] flex flex-col items-center justify-center gap-0.5 px-1 py-1 rounded',
              'border border-neon/30 bg-neon/5 text-neon hover:bg-neon/10 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised',
            )}
            aria-label={`Jump to highest affordable tier (T${bestInBudgetTier})`}
            title={`Highest tier you can afford: T${bestInBudgetTier}`}
          >
            <Target size={11} aria-hidden />
            <span className="text-[8px] font-mono leading-none">T{bestInBudgetTier}</span>
          </button>
        )}

        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Pokemon tiers"
          className="flex flex-col items-center gap-0.5 w-full"
        >
          {poolByTier.map(([tier]) => {
            const s = tierStats.get(tier)!;
            const active = tier === activeTier;
            const affordable = s.affordable > 0;
            const allOwned = s.total > 0 && s.owned === s.total;
            const isBest = tier === bestInBudgetTier;
            return (
              <button
                key={tier}
                ref={el => {
                  if (el) tabButtonRefs.current.set(tier, el);
                  else tabButtonRefs.current.delete(tier);
                }}
                role="tab"
                id={`draft-tier-tab-${tier}`}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onKeyDown={e => onTabKeyDown(e, tier)}
                onClick={() => { setActiveTier(tier); jumpToTier(tier); }}
                aria-label={`Tier ${tier} — ${s.total} pokemon, ${s.affordable} in budget, ${s.owned} owned`}
                className={cn(
                  'group relative w-[40px] flex flex-col items-center justify-center py-0.5 rounded transition-all',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised',
                  active
                    ? 'bg-neon/15 border border-neon/40 shadow-[0_0_8px_rgba(34,211,238,0.20)]'
                    : 'border border-transparent hover:bg-surface-overlay/40',
                )}
                title={`Tier ${tier} · ${s.total} mons · ${s.affordable} in budget · ${s.owned} owned`}
              >
                <span className={cn(
                  'text-[11px] font-mono font-bold leading-none tabular-nums',
                  active
                    ? 'text-neon'
                    : allOwned
                    ? 'text-text-muted/40'
                    : affordable
                    ? 'text-text-primary'
                    : 'text-text-muted',
                )}>
                  {tier}
                </span>
                <div className="mt-0.5 flex items-center gap-0.5 h-1">
                  {affordable ? (
                    <span className="block h-1 rounded-sm bg-neon/60" style={{ width: Math.min(s.affordable * 2.5, 20) }} />
                  ) : !allOwned ? (
                    <span className="block h-1 w-3 rounded-sm bg-text-muted/20" />
                  ) : null}
                </div>
                {isBest && (
                  <span
                    className="absolute -right-px top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-neon shadow-[0_0_6px_rgba(34,211,238,0.7)]"
                    aria-hidden
                  />
                )}
                {allOwned && (
                  <Lock size={6} className="absolute top-0 right-0 text-text-muted/40" aria-hidden />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-auto pt-1 border-t border-border-subtle w-full">
          <button
            onClick={() => scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            className={cn(
              'w-full flex items-center justify-center text-text-muted hover:text-neon py-1',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised',
            )}
            aria-label="Scroll pool to top"
            title="Top"
          >
            <ChevronUp size={12} aria-hidden />
          </button>
        </div>
      </div>

      {/* Pool scroller */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto min-w-0">
        <RailedDraftPoolGrid {...props} tierRefs={tierRefs} bestInBudgetTier={bestInBudgetTier} />
      </div>
    </div>
  );
}

/** Draft pool grid that registers each tier section with a shared ref map. */
function RailedDraftPoolGrid({
  tierRefs,
  bestInBudgetTier: _bestInBudgetTier,
  ...props
}: DraftPoolWithRailProps & {
  tierRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  bestInBudgetTier: number | null;
}) {
  return (
    <div ref={el => attachTierRefs(el, tierRefs)}>
      <DraftPoolGrid {...props} />
    </div>
  );
}

/** Walk children with [data-tier] and register them in the shared map. */
function attachTierRefs(
  rootEl: HTMLDivElement | null,
  tierRefs: React.MutableRefObject<Map<number, HTMLDivElement>>,
) {
  if (!rootEl) {
    tierRefs.current.clear();
    return;
  }
  tierRefs.current.clear();
  const tierEls = rootEl.querySelectorAll<HTMLDivElement>('[data-tier]');
  tierEls.forEach(el => {
    const t = Number(el.getAttribute('data-tier'));
    if (!Number.isNaN(t)) tierRefs.current.set(t, el);
  });
}
