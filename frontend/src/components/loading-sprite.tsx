import { useMemo } from 'react';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { cn } from '@/lib/utils';

/**
 * Pokemon that look natural when rotated — round, mechanical, or
 * spinning-by-canon. Picked once per mount so sequential renders don't
 * flicker between species.
 */
const LOADING_POKEMON = ['voltorb', 'rotom', 'porygon', 'magnemite', 'beldum', 'minior'];

interface LoadingSpriteProps {
  /** Status copy. Default 'Loading...'. */
  label?: string;
  /** Sprite size. Default 'md' (48px). */
  size?: 'sm' | 'md' | 'lg';
  /** Vertical padding. Default 'md'. */
  padding?: 'sm' | 'md' | 'lg';
  className?: string;
}

const PADDING_CLASS: Record<NonNullable<LoadingSpriteProps['padding']>, string> = {
  sm: 'py-3',
  md: 'py-6',
  lg: 'py-10',
};

const SPRITE_SIZE: Record<NonNullable<LoadingSpriteProps['size']>, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
};

/**
 * Themed loading indicator matching the <EmptyState> aesthetic — a slowly
 * rotating Pokemon sprite + status copy in mono caps. Replaces plain
 * "Loading..." text everywhere admin and async surfaces show one.
 *
 * The sprite is randomized per mount; for surfaces that re-mount frequently
 * during a single fetch (which would flicker), wrap in a parent that doesn't
 * remount, or pin the sprite via the `name` override (not yet exposed —
 * extend if a use case appears).
 */
export function LoadingSprite({
  label = 'Loading...',
  size = 'md',
  padding = 'md',
  className,
}: LoadingSpriteProps) {
  const name = useMemo(
    () => LOADING_POKEMON[Math.floor(Math.random() * LOADING_POKEMON.length)],
    [],
  );

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2',
        PADDING_CLASS[padding],
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div
        className="motion-safe:animate-spin"
        style={{ animationDuration: '2.5s', animationTimingFunction: 'linear' }}
      >
        <PokemonSprite name={name} size={SPRITE_SIZE[size]} className="opacity-75" />
      </div>
      <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
