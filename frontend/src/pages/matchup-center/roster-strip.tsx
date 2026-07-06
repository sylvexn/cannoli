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
    activeGlow: 'shadow-[0_0_10px_rgba(59,130,246,0.35)]',
    hoverGlow: 'hover:shadow-[0_0_12px_rgba(59,130,246,0.2)]',
    text: 'text-[#3b82f6]',
    label: 'My Team',
  },
  b: {
    bg: 'bg-[#ef4444]/5',
    border: 'border-[#ef4444]/20',
    activeBorder: 'border-[#ef4444]',
    activeGlow: 'shadow-[0_0_10px_rgba(239,68,68,0.35)]',
    hoverGlow: 'hover:shadow-[0_0_12px_rgba(239,68,68,0.2)]',
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
      <div className="flex items-center justify-between gap-2 mb-1 px-1 min-w-0">
        <span className={cn('text-xs font-medium truncate min-w-0', colors.text)}>
          {label || colors.label}
        </span>
        <span className="text-[10px] text-text-muted shrink-0 whitespace-nowrap">
          {hasSubTeam ? `${subTeam.size}/12 selected` : `${team.length} Pokemon`}
          {!hasSubTeam && ' · click to pick up to 12'}
        </span>
      </div>
      <div className="group/strip flex flex-wrap">
        {team.map(pokemon => {
          const isSelected = subTeam.has(pokemon.name);
          const isDimmed = hasSubTeam && !isSelected;

          return (
            <button
              key={pokemon.name}
              onClick={() => onToggle(pokemon.name)}
              className={cn(
                'group/mon flex-1 min-w-0 flex flex-col items-center gap-0.5 py-1.5 px-0.5 rounded-lg border cursor-pointer',
                'transition-all duration-200 ease-out',
                'hover:scale-110 hover:z-10 hover:bg-surface-overlay/60',
                colors.hoverGlow,
                isSelected
                  ? cn(colors.activeBorder, colors.activeGlow, 'bg-surface-overlay/40')
                  : 'border-transparent',
                isDimmed && 'opacity-35 hover:opacity-70',
              )}
              title={`${pokemon.name} · ${pokemon.types.join('/')} · ${pokemon.stats.spe} SPE`}
            >
              <div className="w-full max-w-10 aspect-square flex items-center justify-center">
                <PokemonSprite name={pokemon.name} size="md" shiny={pokemon.isShiny} className="!w-full !h-full" />
              </div>
              <span className={cn(
                'text-[10px] font-mono leading-tight w-full truncate text-center transition-colors duration-200',
                isSelected
                  ? 'text-text-primary font-semibold'
                  : 'text-text-muted group-hover/mon:text-text-primary',
              )}>
                {pokemon.name}
              </span>
              {pokemon.nickname && (
                <span
                  className="text-[9px] italic font-mono leading-tight w-full truncate text-center text-text-muted"
                  title={pokemon.nickname}
                >
                  "{pokemon.nickname}"
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
