import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import type { RosterPokemon } from '@/lib/types';
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon';
import { getDefensiveMatchups } from '@/lib/type-effectiveness';

interface TypeChartTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
}

const TYPE_ABBR: Record<PokemonType, string> = {
  normal: 'NOR', fire: 'FIR', water: 'WAT', electric: 'ELE', grass: 'GRS',
  ice: 'ICE', fighting: 'FGT', poison: 'PSN', ground: 'GND', flying: 'FLY',
  psychic: 'PSY', bug: 'BUG', rock: 'RCK', ghost: 'GHO', dragon: 'DRG',
  dark: 'DRK', steel: 'STL', fairy: 'FAI',
};

const TYPE_COLORS: Record<PokemonType, string> = {
  normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030',
  grass: '#78c850', ice: '#98d8d8', fighting: '#c03028', poison: '#a040a0',
  ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848',
  steel: '#b8b8d0', fairy: '#ee99ac',
};

function multLabel(m: number): string {
  if (m === 0) return '0';
  if (m === 0.25) return '¼';
  if (m === 0.5) return '½';
  if (m === 1) return '';
  if (m === 2) return '2';
  if (m >= 4) return '4';
  return String(m);
}

function multColor(m: number): string {
  if (m === 0) return 'bg-[#1a1a2e] text-[#555]';
  if (m <= 0.25) return 'bg-[#0d3320] text-[#4ade80]';
  if (m === 0.5) return 'bg-[#0d2e1a]/70 text-[#4ade80]/80';
  if (m === 1) return '';
  if (m === 2) return 'bg-[#3b1515] text-[#f87171]';
  if (m >= 4) return 'bg-[#5c1a1a] text-[#fca5a5]';
  return '';
}

export function TypeChartTab({ teamA, teamB }: TypeChartTabProps) {
  const chartA = useMemo(() =>
    teamA.map(p => ({
      name: p.name,
      matchups: getDefensiveMatchups(p.types as PokemonType[]),
    })),
    [teamA],
  );

  const chartB = useMemo(() =>
    teamB.map(p => ({
      name: p.name,
      matchups: getDefensiveMatchups(p.types as PokemonType[]),
    })),
    [teamB],
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-xs font-medium text-[#3b82f6] mb-1.5">My Team</div>
        <TypeGrid chart={chartA} />
      </div>
      <div>
        <div className="text-xs font-medium text-[#ef4444] mb-1.5">Opponent</div>
        <TypeGrid chart={chartB} />
      </div>
    </div>
  );
}

function TypeGrid({
  chart,
}: {
  chart: { name: string; matchups: { type: PokemonType; multiplier: number }[] }[];
}) {
  if (chart.length === 0) {
    return (
      <div className="rounded-lg border border-border-default p-8 text-center text-text-muted text-sm">
        No team selected
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      <table className="w-full text-xs table-fixed">
        <thead>
          <tr className="border-b border-border-subtle bg-surface-overlay/30">
            <th className="w-10 px-1 py-1.5 text-left text-text-muted font-medium">Type</th>
            {chart.map(p => (
              <th key={p.name} className="px-0.5 py-1.5 text-center" title={p.name}>
                <PokemonSprite name={p.name} size="xs" className="mx-auto" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {POKEMON_TYPES.map(type => (
            <tr key={type} className="border-b border-border-subtle/30">
              <td className="px-1 py-[3px]">
                <span
                  className="inline-block px-1 py-0.5 rounded text-[9px] font-bold text-white leading-none"
                  style={{ backgroundColor: TYPE_COLORS[type] }}
                >
                  {TYPE_ABBR[type]}
                </span>
              </td>
              {chart.map(p => {
                const matchup = p.matchups.find(m => m.type === type);
                const mult = matchup?.multiplier ?? 1;
                return (
                  <td
                    key={p.name}
                    className={cn('py-[3px] text-center font-mono font-bold text-[11px]', multColor(mult))}
                  >
                    {multLabel(mult)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
