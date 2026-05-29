import type { PokemonType } from '@/lib/pokemon';
import { getDefensiveMatchups, groupMatchups } from '@/lib/type-effectiveness';
import { TYPE_COLORS, EFFECTIVENESS_COLORS } from '@/lib/constants';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMemo } from 'react';

interface TypeEffectivenessTooltipProps {
  /** The full type combination to evaluate (pass both for dual-type) */
  types: PokemonType[];
  children: React.ReactNode;
}

const multLabels: { key: keyof typeof EFFECTIVENESS_COLORS; label: string; color: string }[] = [
  { key: 'x4', label: '4×', color: EFFECTIVENESS_COLORS.x4 },
  { key: 'x2', label: '2×', color: EFFECTIVENESS_COLORS.x2 },
  { key: 'x05', label: '½×', color: EFFECTIVENESS_COLORS.x05 },
  { key: 'x025', label: '¼×', color: EFFECTIVENESS_COLORS.x025 },
  { key: 'x0', label: '0×', color: EFFECTIVENESS_COLORS.x0 },
];

export function TypeEffectivenessTooltip({ types, children }: TypeEffectivenessTooltipProps) {
  const groups = useMemo(() => {
    const matchups = getDefensiveMatchups(types);
    return groupMatchups(matchups);
  }, [types.join(',')]);

  // Only show tiers that have entries
  const visibleTiers = multLabels.filter(
    t => (groups as Record<string, { type: PokemonType }[]>)[t.key].length > 0,
  );

  return (
    <Tooltip>
      <TooltipTrigger>
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="p-0 bg-surface-raised border-border-default shadow-lg max-w-[280px]"
      >
        <div className="px-3 py-2">
          {/* Header */}
          <div className="flex items-center gap-1 mb-2">
            {types.map(t => (
              <span
                key={t}
                className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-white"
                style={{ backgroundColor: TYPE_COLORS[t] }}
              >
                {t}
              </span>
            ))}
            <span className="text-[10px] text-text-muted ml-1">defense</span>
          </div>

          {/* Matchup tiers */}
          <div className="space-y-1.5">
            {visibleTiers.map(tier => {
              const entries = (groups as Record<string, { type: PokemonType }[]>)[tier.key];
              return (
                <div key={tier.key} className="flex items-start gap-2">
                  <span
                    className="text-[10px] font-bold tabular-nums w-5 shrink-0 text-right"
                    style={{ color: tier.color }}
                  >
                    {tier.label}
                  </span>
                  <div className="flex flex-wrap gap-0.5">
                    {entries.map(({ type }) => (
                      <span
                        key={type}
                        className="text-[9px] font-semibold uppercase px-1 py-px rounded text-white"
                        style={{ backgroundColor: TYPE_COLORS[type] }}
                      >
                        {type.slice(0, 3)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
