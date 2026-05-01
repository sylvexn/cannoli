import type { PokemonType } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants';
import { TypeEffectivenessTooltip } from './type-effectiveness-tooltip';

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
  xs: 'text-[9px] h-4 min-w-[38px]',
  sm: 'text-[10px] h-5 min-w-[44px]',
  md: 'text-[11px] h-6 min-w-[52px]',
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
  const isMono = types.length === 1;

  if (isMono) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full font-bold uppercase tracking-wider text-white px-2 cursor-default',
          sizeStyles[size],
          className,
        )}
        style={{ backgroundColor: TYPE_COLORS[types[0]] }}
      >
        {TYPE_LABELS[types[0]]}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-stretch rounded-full overflow-hidden font-bold uppercase tracking-wider text-white cursor-default',
        sizeStyles[size],
        className,
      )}
    >
      <span
        className="inline-flex items-center justify-center px-1.5 flex-1"
        style={{ backgroundColor: TYPE_COLORS[types[0]] }}
      >
        {TYPE_LABELS[types[0]]}
      </span>
      <span
        className="inline-flex items-center justify-center px-1.5 flex-1"
        style={{ backgroundColor: TYPE_COLORS[types[1]] }}
      >
        {TYPE_LABELS[types[1]]}
      </span>
    </span>
  );
}
