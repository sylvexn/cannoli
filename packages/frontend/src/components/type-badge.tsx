import type { PokemonType } from '@/lib/pokemon';
import { cn } from '@/lib/utils';

interface TypeBadgeProps {
  type: PokemonType;
  size?: 'sm' | 'md';
  className?: string;
}

const typeLabels: Record<PokemonType, string> = {
  normal: 'NOR', fire: 'FIR', water: 'WAT', electric: 'ELE', grass: 'GRA',
  ice: 'ICE', fighting: 'FIG', poison: 'POI', ground: 'GRO', flying: 'FLY',
  psychic: 'PSY', bug: 'BUG', rock: 'ROC', ghost: 'GHO', dragon: 'DRA',
  dark: 'DRK', steel: 'STL', fairy: 'FAI',
};

export function TypeBadge({ type, size = 'sm', className }: TypeBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded font-bold uppercase tracking-wide text-white',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        className,
      )}
      style={{ backgroundColor: `var(--color-type-${type})` }}
    >
      {typeLabels[type]}
    </span>
  );
}
