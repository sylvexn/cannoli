import type { PokemonType } from '@/lib/pokemon';
import { POKEMON_TYPES } from '@/lib/pokemon';
import { getTypeColors, TYPE_ABBR } from '@/lib/constants';
import type { TypeProfileEntry } from './utils';
import { DefSegment, MultChip } from './defensive-profile';
import { useAuth } from '@/lib/auth-context';

export function TypeCoverageGridInner({ profile, pokemonTypesMap }: {
  profile: Record<PokemonType, TypeProfileEntry>;
  pokemonTypesMap: Map<string, PokemonType[]>;
}) {
  const { colorblindMode } = useAuth();
  const typeColors = getTypeColors(colorblindMode);

  const maxCount = Math.max(
    ...POKEMON_TYPES.map(t => {
      const p = profile[t];
      return p.x4.length + p.x2.length + p.x05.length + p.x025.length + p.x0.length;
    }),
    1
  );

  return (
    <div className="px-2 py-2 flex-1 flex flex-col gap-[2px]">
      {POKEMON_TYPES.map(type => {
        const p = profile[type];
        const totalWeak = p.x4.length + p.x2.length;
        const totalResist = p.x05.length + p.x025.length;
        const totalImmune = p.x0.length;
        const hasAny = totalWeak + totalResist + totalImmune > 0;

        return (
          <div key={type} className="flex items-center gap-0 flex-1 min-h-[18px] group/row">
            <span
              className="text-[8px] font-bold uppercase w-[30px] text-center rounded-l-full text-white shrink-0 leading-none flex items-center justify-center self-stretch"
              style={{ backgroundColor: typeColors[type] }}
            >
              {TYPE_ABBR[type]}
            </span>

            <div className="flex-1 self-stretch rounded-r-full overflow-hidden bg-surface-overlay/15" style={{ display: 'flex' }}>
              {p.x4.map(h => <DefSegment key={`4x-${h.name}`} name={h.name} mult={4} pct={100 / maxCount} types={pokemonTypesMap.get(h.name) ?? []} />)}
              {p.x2.map(h => <DefSegment key={`2x-${h.name}`} name={h.name} mult={2} pct={100 / maxCount} types={pokemonTypesMap.get(h.name) ?? []} />)}
              {p.x05.map(h => <DefSegment key={`.5x-${h.name}`} name={h.name} mult={0.5} pct={100 / maxCount} types={pokemonTypesMap.get(h.name) ?? []} />)}
              {p.x025.map(h => <DefSegment key={`.25x-${h.name}`} name={h.name} mult={0.25} pct={100 / maxCount} types={pokemonTypesMap.get(h.name) ?? []} />)}
              {p.x0.map(h => <DefSegment key={`0x-${h.name}`} name={h.name} mult={0} pct={100 / maxCount} types={pokemonTypesMap.get(h.name) ?? []} />)}
            </div>

            {/* Counts by multiplier */}
            <div className="w-[52px] shrink-0 flex items-center justify-end gap-[3px] pr-1.5 font-mono text-[9px] tabular-nums">
              {p.x4.length > 0 && (
                <span className="text-loss font-black text-[10px] leading-none px-[3px] py-px rounded ring-1 ring-loss/60 bg-loss/10">
                  {p.x4.length}
                </span>
              )}
              {p.x2.length > 0 && <span className="text-loss">{p.x2.length}</span>}
              {p.x05.length > 0 && <span className="text-win">{p.x05.length}</span>}
              {p.x025.length > 0 && (
                <span className="text-win font-black text-[10px] leading-none px-[3px] py-px rounded ring-1 ring-win/60 bg-win/10">
                  {p.x025.length}
                </span>
              )}
              {p.x0.length > 0 && <span className="text-neon font-bold">{p.x0.length}</span>}
              {!hasAny && <span className="text-text-muted">—</span>}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center justify-center gap-1.5 pt-2 pb-1 shrink-0">
        {[4, 2, 0.5, 0.25, 0].map(m => (
          <MultChip key={m} mult={m} size="sm" />
        ))}
      </div>
    </div>
  );
}
