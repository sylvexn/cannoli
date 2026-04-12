import type { ReactNode } from 'react';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { cn } from '@/lib/utils';

export type EmptyStateVariant =
  | 'quiet'         // slow week / no activity
  | 'nothing-here'  // empty list
  | 'season-done'   // phase ended
  | 'not-found'     // 404 / desync
  | 'coming-soon';  // feature stub

interface EmptyStateProps {
  variant: EmptyStateVariant;
  title: string;
  subtitle?: string;
  /** Optional CTA / action element rendered below the subtitle. */
  action?: ReactNode;
  /** Sprite size — 'md' (48px), 'lg' (64px), 'xl' (96px). Default 'lg'. */
  spriteSize?: 'md' | 'lg' | 'xl';
  /** Vertical padding — 'sm' / 'md' / 'lg'. Default 'lg'. */
  padding?: 'sm' | 'md' | 'lg';
  className?: string;
}

const VARIANT_SPRITES: Record<EmptyStateVariant, string> = {
  'quiet': 'munchlax',
  'nothing-here': 'wobbuffet',
  'season-done': 'snorlax',
  'not-found': 'porygon',
  'coming-soon': 'slowpoke',
};

const PADDING_CLASS: Record<NonNullable<EmptyStateProps['padding']>, string> = {
  sm: 'py-4',
  md: 'py-8',
  lg: 'py-12',
};

/**
 * Themed empty state with a Pokemon sprite + flavor copy. Use anywhere a
 * page or panel would otherwise show plain "No items" text. Five archetypes
 * cover the app — pick the variant whose vibe matches the situation.
 *
 * Examples:
 *   <EmptyState variant="quiet" title="Slow week." />
 *   <EmptyState variant="nothing-here" title="No active proposals" subtitle="Nobody's wheelin' and dealin'." />
 *   <EmptyState variant="season-done" title="Regular season's done." subtitle="Playoffs next." />
 */
export function EmptyState({
  variant,
  title,
  subtitle,
  action,
  spriteSize = 'lg',
  padding = 'lg',
  className,
}: EmptyStateProps) {
  const spriteName = VARIANT_SPRITES[variant];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        PADDING_CLASS[padding],
        className,
      )}
    >
      <div className="animate-breathe">
        <PokemonSprite
          name={spriteName}
          size={spriteSize}
          className="opacity-70"
        />
      </div>
      <h3 className="mt-2 text-sm font-medium text-text-secondary">
        {title}
      </h3>
      {subtitle && (
        <p className="mt-1 text-xs text-text-muted max-w-xs leading-snug">
          {subtitle}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
