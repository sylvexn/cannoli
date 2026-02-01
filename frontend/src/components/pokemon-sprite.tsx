import { spriteUrl } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

interface PokemonSpriteProps {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  animated?: boolean;
}

const sizeMap = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
  xl: 'w-24 h-24',
};

// ─── Global sprite cache ───────────────────────────────────────
// Tracks loading state across all instances to avoid duplicate fetches
// and provide instant rendering for already-loaded sprites.
type CacheState = 'loading' | 'loaded' | 'error';
const spriteCache = new Map<string, CacheState>();

function getCacheState(url: string): CacheState {
  return spriteCache.get(url) ?? 'loading';
}

// Pending promises for in-flight loads so multiple callers await the same fetch
const pendingLoads = new Map<string, Promise<void>>();

function loadSprite(url: string): Promise<void> {
  const cached = spriteCache.get(url);
  if (cached === 'loaded' || cached === 'error') return Promise.resolve();

  // If already loading, return the existing promise
  const pending = pendingLoads.get(url);
  if (pending) return pending;

  spriteCache.set(url, 'loading');
  const promise = new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => { spriteCache.set(url, 'loaded'); pendingLoads.delete(url); resolve(); };
    img.onerror = () => { spriteCache.set(url, 'error'); pendingLoads.delete(url); resolve(); };
    img.src = url;
  });
  pendingLoads.set(url, promise);
  return promise;
}

/**
 * Preload a batch of sprite URLs. Call this when entering a page
 * to start fetching sprites before they're rendered.
 */
export function preloadSprites(names: string[], type: 'gen5' | 'ani' = 'gen5') {
  for (const name of names) {
    const url = spriteUrl(name, type);
    if (!spriteCache.has(url)) {
      loadSprite(url);
    }
  }
}

/** Check whether a sprite is still loading (useful for coordinating sibling UI). */
export function useSpriteState(name: string, animated = false): CacheState {
  const type = animated ? 'ani' : 'gen5';
  const url = spriteUrl(name, type);
  const cached = getCacheState(url);
  const [state, setState] = useState<CacheState>(cached);

  useEffect(() => {
    const current = getCacheState(url);
    if (current === 'loaded' || current === 'error') {
      setState(current);
      return;
    }
    setState('loading');
    loadSprite(url).then(() => setState(getCacheState(url)));
  }, [url]);

  return state;
}

export function PokemonSprite({ name, size = 'md', className, animated = false }: PokemonSpriteProps) {
  const type = animated ? 'ani' : 'gen5';
  const url = spriteUrl(name, type);
  const cached = getCacheState(url);
  const [state, setState] = useState<CacheState>(cached);

  useEffect(() => {
    const current = getCacheState(url);
    if (current === 'loaded' || current === 'error') {
      setState(current);
      return;
    }

    setState('loading');
    loadSprite(url).then(() => {
      setState(getCacheState(url));
    });
  }, [url]);

  // Error state
  if (state === 'error') {
    return (
      <div className={cn(sizeMap[size], 'rounded bg-surface-overlay/50 flex items-center justify-center text-text-muted text-[8px]', className)}>
        ?
      </div>
    );
  }

  // Loading skeleton
  if (state === 'loading') {
    return (
      <div className={cn(sizeMap[size], 'rounded bg-surface-overlay/30 animate-pulse', className)} />
    );
  }

  // Loaded
  return (
    <img
      src={url}
      alt={name}
      className={cn(sizeMap[size], 'object-contain pixelated', className)}
    />
  );
}
