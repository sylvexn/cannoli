import type { RosterPokemon } from '@/lib/types';
import type { LeagueConfig } from '@/lib/types';
import { getEffectiveCost } from '@/mocks/tier-list';
import { rosterPointsUsed, teraCaptainCount } from '@/lib/roster';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { AbilityChip } from '@/components/ability-chip';
import { KDDisplay } from '@/components/kd-display';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { TYPE_COLORS } from '@/lib/constants';
import { StatBar } from '@/components/stat-bar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { TYPE_ABBR } from './utils';
import type { SwapEntry } from './utils';

type SortKey = 'tier' | 'kills' | 'deaths' | 'kpg' | 'spe';

interface RosterTableProps {
  activeRoster: RosterPokemon[];
  sortedRoster: { mon: RosterPokemon; originalIndex: number }[];
  swaps: SwapEntry[];
  config: LeagueConfig;
  theorycraftMode: boolean;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  onResetAll: () => void;
}

export function RosterTable({
  activeRoster,
  sortedRoster,
  swaps,
  config,
  theorycraftMode,
  sortKey,
  sortDir,
  onSort,
  onResetAll,
}: RosterTableProps) {
  const pointsUsed = rosterPointsUsed(activeRoster);
  const captainCount = teraCaptainCount(activeRoster);
  const teamKills = activeRoster.reduce((sum, p) => sum + p.seasonStats.kills, 0);
  const teamDeaths = activeRoster.reduce((sum, p) => sum + p.seasonStats.deaths, 0);

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null;
    return sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />;
  };

  return (
    <Card className="xl:col-span-2 bg-surface-raised border-border-default flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-text-primary tracking-tight">Roster</CardTitle>
          {theorycraftMode && swaps.length > 0 && (
            <button onClick={onResetAll} className="flex items-center gap-1 text-xs text-text-muted hover:text-loss transition-colors">
              <RotateCcw size={12} /> Reset all
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                <th className="px-3 py-2.5 text-left w-12">
                  <button onClick={() => onSort('tier')} className="flex items-center gap-0.5 hover:text-neon transition-colors">
                    Cost <SortIcon k="tier" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">Pokemon</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-left hidden lg:table-cell">Abilities</th>
                <th className="px-3 py-2.5 text-right font-mono">
                  <button onClick={() => onSort('kills')} className="flex items-center gap-0.5 hover:text-neon transition-colors ml-auto">
                    K <SortIcon k="kills" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right font-mono">
                  <button onClick={() => onSort('deaths')} className="flex items-center gap-0.5 hover:text-neon transition-colors ml-auto">
                    D <SortIcon k="deaths" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right font-mono">GP</th>
                <th className="px-3 py-2.5 text-right font-mono">
                  <button onClick={() => onSort('kpg')} className="flex items-center gap-0.5 hover:text-neon transition-colors ml-auto">
                    KPG <SortIcon k="kpg" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right font-mono">
                  <button onClick={() => onSort('spe')} className="flex items-center gap-0.5 hover:text-neon transition-colors ml-auto">
                    Spe <SortIcon k="spe" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRoster.map(({ mon, originalIndex }) => {
                const isSwapped = swaps.some(s => s.index === originalIndex);
                const effectiveCost = getEffectiveCost(mon.name, mon.isTeraCaptain);
                const kpg = mon.seasonStats.gp ? (mon.seasonStats.kills / mon.seasonStats.gp).toFixed(1) : '—';
                const bst = mon.stats.hp + mon.stats.atk + mon.stats.def + mon.stats.spa + mon.stats.spd + mon.stats.spe;

                return (
                  <tr
                    key={`${originalIndex}-${mon.name}`}
                    className={`group border-b border-border-subtle/50 transition-colors ${isSwapped ? 'bg-pink/5' : 'hover:bg-surface-overlay/40'}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <TierBadge points={effectiveCost} />
                        {mon.isTeraCaptain && effectiveCost !== mon.tier && (
                          <span className="text-[9px] text-text-muted tabular-nums">({mon.tier})</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Tooltip>
                        <TooltipTrigger>
                          <div className="flex items-center gap-2 cursor-default">
                            <PokemonSprite name={mon.name} size="sm" className="shrink-0" />
                            <span className={`text-sm font-medium ${mon.isTeraCaptain ? 'text-pink' : 'text-text-primary'} group-hover:text-neon transition-colors`}>
                              {mon.name}
                            </span>
                            {mon.isTeraCaptain && (
                              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-pink/20 text-pink text-[8px] font-black border border-pink/40">T</span>
                            )}
                            {isSwapped && <span className="text-[10px] text-pink">(swapped)</span>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" align="start" className="bg-surface-raised border-border-default p-0 w-64">
                          <div className="p-2.5">
                            {/* Header */}
                            <div className="flex items-start gap-2.5 mb-2">
                              <PokemonSprite name={mon.name} size="lg" />
                              <div className="flex-1 min-w-0 pt-0.5">
                                <div className="text-xs font-semibold text-text-primary">{mon.name}</div>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <TypeChip types={mon.types} size="xs" />
                                  <TierBadge points={effectiveCost} />
                                </div>
                                {mon.isTeraCaptain && mon.teraTypes && mon.teraTypes.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <span className="text-[7px] font-black text-pink">TERA</span>
                                    {mon.teraTypes.map(t => (
                                      <span key={t} className="text-[7px] font-bold uppercase rounded px-1 py-px text-white" style={{ backgroundColor: TYPE_COLORS[t] }}>{TYPE_ABBR[t]}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Stats */}
                            <div className="space-y-0.5 mb-2">
                              <StatBar label="HP" value={mon.stats.hp} />
                              <StatBar label="Atk" value={mon.stats.atk} />
                              <StatBar label="Def" value={mon.stats.def} />
                              <StatBar label="SpA" value={mon.stats.spa} />
                              <StatBar label="SpD" value={mon.stats.spd} />
                              <StatBar label="Spe" value={mon.stats.spe} />
                            </div>
                            <div className="text-[9px] font-mono text-text-muted text-right">BST {bst}</div>
                            {/* Abilities */}
                            {mon.abilities.length > 0 && (
                              <div className="flex flex-wrap gap-0.5 mt-1.5 pt-1.5 border-t border-border-subtle/50">
                                {mon.abilities.map(a => <AbilityChip key={a} name={a} />)}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-2.5">
                      <TypeChip types={mon.types} size="xs" />
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-0.5">
                        {mon.abilities.map(a => <AbilityChip key={a} name={a} />)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-win">{mon.seasonStats.kills}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-loss">{mon.seasonStats.deaths}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-text-muted">{mon.seasonStats.gp}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-text-secondary font-semibold">{kpg}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-text-secondary">{mon.stats.spe}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="px-4 py-2 border-t border-border-subtle flex items-center justify-between text-[11px] text-text-muted font-medium">
          <span className="font-mono">{activeRoster.length} mon &middot; {pointsUsed}/{config.pointCap}pt</span>
          <div className="flex items-center gap-3 font-mono">
            <span>Tera <span className={captainCount > config.teraCaptainSlots ? 'text-loss' : 'text-pink'}>{captainCount}</span>/{config.teraCaptainSlots}</span>
            <KDDisplay kills={teamKills} deaths={teamDeaths} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
