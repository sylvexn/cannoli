import { spriteUrl } from '@/lib/pokemon';
import { cn } from '@/lib/utils';
import { useState } from 'react';

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

export function PokemonSprite({ name, size = 'md', className, animated = false }: PokemonSpriteProps) {
  const [error, setError] = useState(false);
  const type = animated ? 'ani' : 'gen5';
  const url = spriteUrl(name, type);

  if (error) {
    return (
      <div className={cn(sizeMap[size], 'rounded bg-surface-raised flex items-center justify-center text-text-muted text-[8px]', className)}>
        ?
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={name}
      className={cn(sizeMap[size], 'object-contain pixelated', className)}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
