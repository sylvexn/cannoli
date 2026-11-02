import type { PokemonType } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants';
import { TypeEffectivenessTooltip } from './type-effectiveness-tooltip';
import { typePillClass, typePillStyle } from './type-badge';

/**
 * @deprecated Import `TYPE_COLORS` from `@/lib/constants` directly.
 * Re-exported here only for callers that haven't migrated yet.
 */
export const typeColors = TYPE_COLORS;

interface TypeChipProps {
  types: PokemonType[];
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  /** Disable the effectiveness tooltip */
  noTooltip?: boolean;
}

const sizeStyles = {
  xs: 'text-[9px] px-[3px]',
  sm: 'text-[9px] px-[3px]',
  md: 'text-[10.5px] px-1',
};

export function TypeChip({ types, size = 'sm', className, noTooltip }: TypeChipProps) {
  if (types.length === 0) return null;

  const chip = <TypeChipInner types={types} size={size} className={className} />;

  if (noTooltip) return chip;

  return (
    <TypeEffectivenessTooltip types={types}>
      {chip}
    </TypeEffectivenessTooltip>
  );
}

function TypeChipInner({ types, size = 'sm', className }: { types: PokemonType[]; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)}>
      {types.map(t => (
        <span key={t} className={cn(typePillClass, sizeStyles[size])} style={typePillStyle(t)}>
          {TYPE_LABELS[t]}
        </span>
      ))}
    </span>
  );
}
