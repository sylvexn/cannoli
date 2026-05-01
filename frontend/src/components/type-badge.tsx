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

export function TypeBadge({ type, size = 'sm', className, noTooltip }: TypeBadgeProps) {
  const badge = (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded font-bold uppercase tracking-wide text-white cursor-default',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        className,
      )}
      style={{ backgroundColor: `var(--color-type-${type})` }}
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
