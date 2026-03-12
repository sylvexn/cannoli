import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { typeColors } from '@/components/type-chip';
import type { RosterPokemon } from '@/lib/types';
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon';
import { getDefensiveMatchups } from '@/lib/type-effectiveness';

interface TypeChartTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
}

function multLabel(m: number): string {
  if (m === 0) return '0';
  if (m === 0.25) return '¼';
  if (m === 0.5) return '½';
  if (m > 0 && m < 0.5) return '¼';
  if (m > 0.5 && m < 1) return '¾';
  if (m === 1) return '';
  if (m > 1 && m < 2) return '1½';
  if (m === 2) return '2';
  if (m > 2 && m < 4) return '3';
  if (m >= 4) return '4';
  return String(m);
}

function multColor(m: number): string {
  if (m === 0) return 'bg-[#1a1a2e] text-[#555]';
  if (m <= 0.25) return 'bg-[#0d3320] text-[#4ade80]';
  if (m > 0 && m < 1) return 'bg-[#0d2e1a]/70 text-[#4ade80]/80';
  if (m === 1) return '';
  if (m > 1 && m < 2) return 'bg-[#2e1515] text-[#fca5a5]/80';
  if (m === 2) return 'bg-[#3b1515] text-[#f87171]';
  if (m >= 4) return 'bg-[#5c1a1a] text-[#fca5a5]';
  return '';
}

export function TypeChartTab({ teamA, teamB }: TypeChartTabProps) {
  const chartA = useMemo(() =>
    teamA.map(p => ({
      name: p.name,
      matchups: getDefensiveMatchups(p.types as PokemonType[], p.abilities?.[0]),
    })),
    [teamA],
  );

  const chartB = useMemo(() =>
    teamB.map(p => ({
      name: p.name,
      matchups: getDefensiveMatchups(p.types as PokemonType[], p.abilities?.[0]),
    })),
    [teamB],
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-xs font-heading font-semibold text-[#3b82f6] mb-1.5 uppercase tracking-wider">My Team</div>
        <TypeGrid chart={chartA} />
      </div>
      <div>
        <div className="text-xs font-heading font-semibold text-[#ef4444] mb-1.5 uppercase tracking-wider">Opponent</div>
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
                  className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white leading-none"
                  style={{ backgroundColor: typeColors[type] }}
                >
                  {type.slice(0, 3)}
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
