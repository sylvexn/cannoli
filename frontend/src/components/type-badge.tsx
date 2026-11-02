import type { CSSProperties } from 'react';
import type { PokemonType } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { TYPE_LABELS } from '@/lib/constants';
import { TypeEffectivenessTooltip } from './type-effectiveness-tooltip';

interface TypeBadgeProps {
  type: PokemonType;
  size?: 'sm' | 'md';
  className?: string;
  noTooltip?: boolean;
}

/** Inline style for a 1.4 type pill: soft tinted fill, colored text. The text
 *  lightness is floored so dark types (Dark, Ghost, Poison, Dragon) stay
 *  readable at 9px. Uses the CSS type vars so colorblind mode still applies. */
export function typePillStyle(type: PokemonType): CSSProperties {
  const v = `var(--color-type-${type})`;
  return {
    backgroundColor: `color-mix(in oklab, ${v} 22%, transparent)`,
    color: `oklch(from ${v} max(l, 0.8) c h)`,
  };
}

export const typePillClass = 'inline-flex items-center justify-center rounded-[3px] font-bold uppercase tracking-[0.04em] leading-[1.45] cursor-default';

export function TypeBadge({ type, size = 'sm', className, noTooltip }: TypeBadgeProps) {
  const badge = (
    <span
      className={cn(typePillClass, size === 'sm' ? 'px-[3px] text-[9px]' : 'px-1 text-[10.5px]', className)}
      style={typePillStyle(type)}
    >
      {TYPE_LABELS[type]}
    </span>
  );

  if (noTooltip) return badge;

  return (
    <TypeEffectivenessTooltip types={[type]}>
      {badge}
    </TypeEffectivenessTooltip>
  );
}
