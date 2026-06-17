import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import { TYPE_COLORS } from '@/lib/constants';
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
      nickname: p.nickname,
      isShiny: p.isShiny,
      matchups: getDefensiveMatchups(p.types as PokemonType[], p.abilities?.[0]),
    })),
    [teamA],
  );

  const chartB = useMemo(() =>
    teamB.map(p => ({
      name: p.name,
      nickname: p.nickname,
      isShiny: p.isShiny,
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
  chart: { name: string; nickname?: string | null; isShiny?: boolean; matchups: { type: PokemonType; multiplier: number }[] }[];
}) {
  if (chart.length === 0) {
    return (
      <div className="rounded-lg border border-border-default p-8 text-center text-text-muted text-sm">
        No team selected
      </div>
    );
  }

  const summary = POKEMON_TYPES.map(type => {
    let resist = 0;
    let weak = 0;
    for (const p of chart) {
      const mult = p.matchups.find(m => m.type === type)?.multiplier ?? 1;
      if (mult < 1) resist++;
      else if (mult > 1) weak++;
    }
    return { type, resist, weak };
  });

  return (
    <div className="rounded-lg border border-border-default overflow-x-auto">
      <table className="text-xs border-separate border-spacing-0">
        <thead>
          <tr className="bg-surface-overlay/30">
            <th className="sticky left-0 z-10 bg-surface-raised w-28 px-1.5 py-1.5 text-left text-text-muted font-medium border-b border-r border-border-subtle">
              Pokemon
            </th>
            {POKEMON_TYPES.map(type => (
              <th key={type} className="px-0.5 py-1.5 text-center border-b border-border-subtle w-9">
                <span
                  className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white leading-none"
                  style={{ backgroundColor: TYPE_COLORS[type] }}
                >
                  {type.slice(0, 3)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.map(p => (
            <tr key={p.name} className="group/row">
              <td className="sticky left-0 z-10 bg-surface-raised group-hover/row:bg-surface-overlay/40 px-1.5 py-[3px] border-b border-r border-border-subtle/30 transition-colors">
                <Link
                  to={pokemonRoute(p.name)}
                  title={p.nickname ? `${p.name} — "${p.nickname}"` : p.name}
                  className="flex items-center gap-1.5 hover:text-text-primary"
                >
                  <PokemonSprite name={p.name} size="xs" shiny={p.isShiny} className="shrink-0" />
                  <span className="text-[10px] font-mono truncate">{p.name}</span>
                </Link>
              </td>
              {POKEMON_TYPES.map(type => {
                const matchup = p.matchups.find(m => m.type === type);
                const mult = matchup?.multiplier ?? 1;
                return (
                  <td
                    key={type}
                    className={cn(
                      'py-[3px] text-center font-mono font-bold text-[11px] border-b border-border-subtle/30',
                      multColor(mult),
                    )}
                  >
                    {multLabel(mult)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="sticky bottom-0 z-10 bg-surface-overlay/40 backdrop-blur-sm">
            <td className="sticky left-0 z-20 bg-surface-raised px-1.5 py-1 border-t border-r border-border-default text-[9px] font-heading font-semibold uppercase tracking-wider text-text-muted">
              Resist / Weak
            </td>
            {summary.map(({ type, resist, weak }) => (
              <td
                key={type}
                className="py-1 text-center border-t border-border-default leading-none align-middle"
                title={`${type}: ${resist} resist, ${weak} weak`}
              >
                <div className="flex flex-col items-center gap-px font-mono font-bold text-[10px]">
                  <span className={cn(resist > 0 ? 'text-[#4ade80]' : 'text-[#444]')}>{resist}</span>
                  <span className={cn(weak > 0 ? 'text-[#f87171]' : 'text-[#444]')}>{weak}</span>
                </div>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
