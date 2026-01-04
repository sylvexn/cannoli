import type { PokemonType } from '@/lib/pokemon';
import { cn } from '@/lib/utils';

interface TypeChipProps {
  types: PokemonType[];
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const typeLabels: Record<PokemonType, string> = {
  normal: 'NOR', fire: 'FIR', water: 'WAT', electric: 'ELE', grass: 'GRA',
  ice: 'ICE', fighting: 'FIG', poison: 'POI', ground: 'GRO', flying: 'FLY',
  psychic: 'PSY', bug: 'BUG', rock: 'ROC', ghost: 'GHO', dragon: 'DRA',
  dark: 'DRK', steel: 'STL', fairy: 'FAI',
};

const typeColors: Record<PokemonType, string> = {
  normal: '#a8a77a', fire: '#ee8130', water: '#6390f0', electric: '#f7d02c',
  grass: '#7ac74c', ice: '#96d9d6', fighting: '#c22e28', poison: '#a33ea1',
  ground: '#e2bf65', flying: '#a98ff3', psychic: '#f95587', bug: '#a6b91a',
  rock: '#b6a136', ghost: '#735797', dragon: '#6f35fc', dark: '#705746',
  steel: '#b7b7ce', fairy: '#d685ad',
};

const sizeStyles = {
  xs: 'text-[9px] h-4 min-w-[38px]',
  sm: 'text-[10px] h-5 min-w-[44px]',
  md: 'text-[11px] h-6 min-w-[52px]',
};

export function TypeChip({ types, size = 'sm', className }: TypeChipProps) {
  if (types.length === 0) return null;

  const isMono = types.length === 1;

  if (isMono) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full font-bold uppercase tracking-wider text-white px-2',
          sizeStyles[size],
          className,
        )}
        style={{ backgroundColor: typeColors[types[0]] }}
      >
        {typeLabels[types[0]]}
      </span>
    );
  }

  // Dual type: split chip
  return (
    <span
      className={cn(
        'inline-flex items-stretch rounded-full overflow-hidden font-bold uppercase tracking-wider text-white',
        sizeStyles[size],
        className,
      )}
    >
      <span
        className="inline-flex items-center justify-center px-1.5 flex-1"
        style={{ backgroundColor: typeColors[types[0]] }}
      >
        {typeLabels[types[0]]}
      </span>
      <span
        className="inline-flex items-center justify-center px-1.5 flex-1"
        style={{ backgroundColor: typeColors[types[1]] }}
      >
        {typeLabels[types[1]]}
      </span>
    </span>
  );
}
