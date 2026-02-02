import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import type { RosterPokemon } from '@/lib/types';

interface RosterStripProps {
  team: RosterPokemon[];
  subTeam: Set<string>;
  onToggle: (name: string) => void;
  side: 'a' | 'b';
  label?: string;
}

const sideColors = {
  a: {
    bg: 'bg-[#3b82f6]/5',
    border: 'border-[#3b82f6]/20',
    activeBorder: 'border-[#3b82f6]',
    activeGlow: 'shadow-[0_0_8px_rgba(59,130,246,0.3)]',
    text: 'text-[#3b82f6]',
    label: 'My Team',
  },
  b: {
    bg: 'bg-[#ef4444]/5',
    border: 'border-[#ef4444]/20',
    activeBorder: 'border-[#ef4444]',
    activeGlow: 'shadow-[0_0_8px_rgba(239,68,68,0.3)]',
    text: 'text-[#ef4444]',
    label: 'Opponent',
  },
};

export function RosterStrip({ team, subTeam, onToggle, side, label }: RosterStripProps) {
  const colors = sideColors[side];
  const hasSubTeam = subTeam.size > 0;

  if (team.length === 0) {
    return (
      <div className={cn('flex-1 rounded-lg border border-dashed p-4 flex items-center justify-center', colors.border, colors.bg)}>
        <span className="text-sm text-text-muted">
          {side === 'a' ? 'Select your team above' : 'Select an opponent above'}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex-1 rounded-lg border p-2', colors.border, colors.bg)}>
      <div className="flex items-center justify-between mb-1.5 px-1">
        <span className={cn('text-xs font-medium', colors.text)}>
          {label || colors.label}
        </span>
        <span className="text-[10px] text-text-muted">
          {hasSubTeam ? `${subTeam.size}/6 selected` : `${team.length} Pokemon`}
          {!hasSubTeam && ' · click to pick 6'}
        </span>
      </div>
      <div className="flex gap-1 flex-wrap">
        {team.map(pokemon => {
          const isSelected = subTeam.has(pokemon.name);
          const isDimmed = hasSubTeam && !isSelected;

          return (
            <button
              key={pokemon.name}
              onClick={() => onToggle(pokemon.name)}
              className={cn(
                'flex flex-col items-center gap-0.5 p-1 rounded-md border transition-all cursor-pointer',
                'hover:bg-surface-overlay/60',
                isSelected
                  ? cn(colors.activeBorder, colors.activeGlow, 'bg-surface-overlay/40')
                  : 'border-transparent',
                isDimmed && 'opacity-35',
              )}
              title={`${pokemon.name} · ${pokemon.types.join('/')} · ${pokemon.stats.spe} SPE`}
            >
              <PokemonSprite name={pokemon.name} size="sm" />
              <span className={cn(
                'text-[9px] leading-tight max-w-[52px] truncate',
                isSelected ? 'text-text-primary font-medium' : 'text-text-muted',
              )}>
                {pokemon.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
