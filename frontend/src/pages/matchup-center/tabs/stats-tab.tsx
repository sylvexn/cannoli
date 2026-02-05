import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import type { RosterPokemon } from '@/lib/types';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface StatsTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
}

type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD', spe: 'SPE',
};

function statColor(val: number): string {
  if (val >= 130) return 'text-[#4ade80]';
  if (val >= 100) return 'text-[#86efac]';
  if (val >= 80) return 'text-text-primary';
  if (val >= 60) return 'text-[#fbbf24]';
  return 'text-[#f87171]';
}

export function StatsTab({ teamA, teamB }: StatsTabProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <StatsTable team={teamA} side="a" />
      <StatsTable team={teamB} side="b" />
    </div>
  );
}

function StatsTable({ team, side }: { team: RosterPokemon[]; side: 'a' | 'b' }) {
  const [sortKey, setSortKey] = useState<StatKey>('spe');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() =>
    [...team].sort((a, b) => {
      const diff = a.stats[sortKey] - b.stats[sortKey];
      return sortDir === 'desc' ? -diff : diff;
    }),
    [team, sortKey, sortDir],
  );

  const averages = useMemo(() => {
    if (team.length === 0) return null;
    const avg: Record<StatKey, number> = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    for (const p of team) {
      for (const k of STAT_KEYS) avg[k] += p.stats[k];
    }
    for (const k of STAT_KEYS) avg[k] = Math.round(avg[k] / team.length);
    return avg;
  }, [team]);

  function handleSort(key: StatKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const colors = side === 'a'
    ? { header: 'bg-[#3b82f6]/10 text-[#3b82f6]', avg: 'bg-[#3b82f6]/5' }
    : { header: 'bg-[#ef4444]/10 text-[#ef4444]', avg: 'bg-[#ef4444]/5' };

  if (team.length === 0) {
    return (
      <div className="rounded-lg border border-border-default p-8 text-center text-text-muted text-sm">
        No team selected
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className={colors.header}>
            <th className="px-2 py-2 text-left font-medium">Pokemon</th>
            <th className="w-8"></th>
            {STAT_KEYS.map(key => (
              <th
                key={key}
                className="px-1.5 py-2 text-right font-medium cursor-pointer hover:text-text-primary transition-colors select-none"
                onClick={() => handleSort(key)}
              >
                <span className="inline-flex items-center gap-0.5">
                  {STAT_LABELS[key]}
                  {sortKey === key && (
                    sortDir === 'desc'
                      ? <ChevronDown size={10} />
                      : <ChevronUp size={10} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(pokemon => (
            <tr key={pokemon.name} className="border-t border-border-subtle/50 hover:bg-surface-overlay/30">
              <td className="px-2 py-[3px] text-text-primary font-mono font-medium truncate max-w-[120px]">{pokemon.name}</td>
              <td className="py-[3px]">
                <PokemonSprite name={pokemon.name} size="xs" />
              </td>
              {STAT_KEYS.map(key => (
                <td
                  key={key}
                  className={cn(
                    'px-1.5 py-1 text-right font-mono tabular-nums',
                    statColor(pokemon.stats[key]),
                  )}
                >
                  {pokemon.stats[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {averages && (
          <tfoot>
            <tr className={cn('border-t border-border-default font-medium', colors.avg)}>
              <td className="px-2 py-1.5 text-text-muted" colSpan={2}>Team Average</td>
              {STAT_KEYS.map(key => (
                <td
                  key={key}
                  className={cn('px-1.5 py-1.5 text-right font-mono tabular-nums', statColor(averages[key]))}
                >
                  {averages[key]}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
