import { PokemonSprite } from '@/components/pokemon-sprite';
import type { ApiMatchPokemon } from '@/lib/api';
import { cn } from '@/lib/utils';

interface BroughtPreviewProps {
  home: ApiMatchPokemon[];
  away: ApiMatchPokemon[];
  homeColor?: string;
  awayColor?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Two-row sprite trio (home above, away below) used as the preview pane
 * for replay gallery cards. Renders the 6 mons each side actually brought
 * — falls through to the parent's empty placeholder when no summary
 * data is available.
 */
export function BroughtPreview({
  home,
  away,
  homeColor,
  awayColor,
  size = 'sm',
  className,
}: BroughtPreviewProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 px-2 py-1', className)}>
      <SpriteRow team={home} size={size} accent={homeColor} />
      <SpriteRow team={away} size={size} accent={awayColor} />
    </div>
  );
}

function SpriteRow({
  team,
  size,
  accent,
}: {
  team: ApiMatchPokemon[];
  size: 'sm' | 'md';
  accent?: string;
}) {
  const slotPx = size === 'md' ? 40 : 30;
  const slots = Array.from({ length: 6 }, (_, i) => team[i]);
  return (
    <div className="flex items-center gap-0.5">
      {slots.map((mon, i) => (
        <div
          key={i}
          className="relative flex items-center justify-center rounded"
          style={{
            width: slotPx,
            height: slotPx,
            backgroundColor: accent ? `${accent}10` : undefined,
            borderBottom: accent ? `1px solid ${accent}40` : undefined,
          }}
          title={mon ? spriteTitle(mon) : undefined}
        >
          {mon ? (
            <PokemonSprite
              name={mon.name}
              shiny={!!mon.isShiny}
              size={size === 'md' ? 'md' : 'sm'}
            />
          ) : (
            <div className="w-3 h-3 rounded-full border border-dashed border-text-muted/30" />
          )}
        </div>
      ))}
    </div>
  );
}

function spriteTitle(mon: ApiMatchPokemon): string {
  const parts = [mon.nickname ? `${mon.name} "${mon.nickname}"` : mon.name];
  parts.push(`${mon.kills}K / ${mon.deaths}D`);
  if (mon.teraUsed) parts.push(mon.teraType ? `tera ${mon.teraType}` : 'tera');
  return parts.join(' · ');
}
