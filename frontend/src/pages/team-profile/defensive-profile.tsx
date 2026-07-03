import { useMemo } from 'react';
import type { PokemonType } from '@/lib/pokemon';
import { getTypeColors } from '@/lib/constants';
import { getDefensiveMatchups, groupMatchups } from '@/lib/type-effectiveness';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/lib/auth-context';

// ─── Multiplier styles ───────────────────────────────────────────
export const MULT_STYLES: Record<string, { bg: string; hover: string; border: string; text: string; label: string; textCls: string }> = {
  '4':    { bg: 'rgba(220,38,38,0.7)',  hover: 'rgba(220,38,38,0.9)',  border: '#fca5a5', text: '#fff', label: '4x',  textCls: 'text-loss font-bold' },
  '2':    { bg: 'rgba(239,68,68,0.5)',  hover: 'rgba(239,68,68,0.75)', border: '#f87171', text: '#fff', label: '2x',  textCls: 'text-loss' },
  '0.5':  { bg: 'rgba(22,163,74,0.45)', hover: 'rgba(22,163,74,0.7)',  border: '#4ade80', text: '#fff', label: '½x', textCls: 'text-win' },
  '0.25': { bg: 'rgba(21,128,61,0.6)',  hover: 'rgba(21,128,61,0.85)', border: '#22c55e', text: '#fff', label: '¼x', textCls: 'text-win font-bold' },
  '0':    { bg: 'rgba(8,145,178,0.5)',  hover: 'rgba(8,145,178,0.75)', border: '#22d3ee', text: '#fff', label: '0x',  textCls: 'text-neon font-bold' },
};

function getMultKey(mult: number): string {
  return mult === 4 ? '4' : mult === 2 ? '2' : mult === 0.5 ? '0.5' : mult === 0.25 ? '0.25' : '0';
}

// ─── MultChip ────────────────────────────────────────────────────
export function MultChip({ mult, size = 'md' }: { mult: number; size?: 'sm' | 'md' }) {
  const s = MULT_STYLES[getMultKey(mult)];
  const px = size === 'sm' ? 18 : 22;
  const fs = size === 'sm' ? 8 : 10;
  return (
    <span
      style={{
        minWidth: px,
        height: px,
        borderRadius: 9999,
        backgroundColor: s.bg,
        border: `1.5px solid ${s.border}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: fs,
        fontWeight: 800,
        color: s.text,
        lineHeight: 1,
        flexShrink: 0,
        padding: '0 3px',
      }}
    >
      {s.label}
    </span>
  );
}

// ─── DefSegment ──────────────────────────────────────────────────
export function DefSegment({ name, mult, pct, types }: { name: string; mult: number; pct: number; types: PokemonType[] }) {
  const s = MULT_STYLES[getMultKey(mult)];
  const { colorblindMode } = useAuth();
  const typeColors = getTypeColors(colorblindMode);

  const matchups = useMemo(() => {
    const raw = getDefensiveMatchups(types);
    return groupMatchups(raw);
  }, [types.join(',')]);

  const tiers: { key: string; label: string; color: string }[] = [
    { key: 'x4', label: '4×', color: '#f87171' },
    { key: 'x2', label: '2×', color: '#fb923c' },
    { key: 'x05', label: '½×', color: '#4ade80' },
    { key: 'x025', label: '¼×', color: '#22d3ee' },
    { key: 'x0', label: '0×', color: '#a78bfa' },
  ];

  const visibleTiers = tiers.filter(t => (matchups as Record<string, { type: PokemonType }[]>)[t.key].length > 0);

  return (
    <Tooltip>
      <TooltipTrigger
        style={{
          width: `${pct}%`,
          minWidth: 6,
          height: '100%',
          backgroundColor: s.bg,
          display: 'block',
          cursor: 'default',
          borderRight: '1px solid rgba(10,10,15,0.3)',
          transition: 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1), background-color 0.15s',
        }}
        className="hover:!scale-y-[1.3] hover:rounded-sm hover:z-10"
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = s.hover; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = s.bg; }}
      />
      <TooltipContent side="top" className="bg-surface-overlay border-border-default p-0 max-w-[260px]">
        {/* Header: sprite + name + mult + types */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border-subtle">
          <PokemonSprite name={name} size="xs" />
          <span className="text-[11px] text-text-primary font-medium">{name}</span>
          <MultChip mult={mult} />
          <div className="ml-auto flex gap-0.5">
            {types.map(t => (
              <span key={t} className="text-[8px] font-bold uppercase px-1 py-px rounded text-white" style={{ backgroundColor: typeColors[t] }}>
                {t.slice(0, 3)}
              </span>
            ))}
          </div>
        </div>
        {/* Defensive matchup chart */}
        <div className="px-2.5 py-1.5 space-y-1">
          {visibleTiers.map(tier => {
            const entries = (matchups as Record<string, { type: PokemonType }[]>)[tier.key];
            return (
              <div key={tier.key} className="flex items-start gap-1.5">
                <span className="text-[9px] font-bold tabular-nums w-4 shrink-0 text-right" style={{ color: tier.color }}>
                  {tier.label}
                </span>
                <div className="flex flex-wrap gap-px">
                  {entries.map(({ type }) => (
                    <span key={type} className="text-[8px] font-semibold uppercase px-1 py-px rounded text-white" style={{ backgroundColor: typeColors[type] }}>
                      {type.slice(0, 3)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
