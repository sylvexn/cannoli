import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { PokemonType } from '@/lib/pokemon';
import { TYPE_COLORS } from '@/lib/constants';
import { pokemonRoute } from '@/lib/pokemon-route';

interface TeraIndicatorProps {
  /** Pokemon display name — rendered in pink when tera captain */
  name: string;
  isTeraCaptain: boolean;
  teraTypes?: PokemonType[];
  className?: string;
  /** When true, the name becomes a Link to /pokemon/:name */
  asLink?: boolean;
}


/**
 * Displays a Pokemon name with tera captain styling.
 * - Tera captains: tiny pink "C" tag that shows tera types on hover
 * - Non-captains: name in default color, no badge
 */
export function TeraIndicator({ name, isTeraCaptain, teraTypes, className, asLink }: TeraIndicatorProps) {
  if (!isTeraCaptain) {
    if (asLink) {
      return (
        <Link
          to={pokemonRoute(name)}
          onClick={e => e.stopPropagation()}
          className={cn('text-text-primary hover:text-neon hover:underline transition-colors', className)}
        >
          {name}
        </Link>
      );
    }
    return <span className={cn('text-text-primary', className)}>{name}</span>;
  }

  const nameNode = asLink ? (
    <Link
      to={pokemonRoute(name)}
      onClick={e => e.stopPropagation()}
      className="text-text-primary hover:text-neon hover:underline transition-colors"
    >
      {name}
    </Link>
  ) : (
    <span className="text-text-primary">{name}</span>
  );

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {nameNode}
      <Tooltip>
        <TooltipTrigger
          className="shrink-0 inline-flex items-center justify-center h-3.5 px-1 rounded-[3px] bg-[#ff7ae0] text-[#0b0d11] text-[9.5px] font-extrabold leading-none cursor-default hover:brightness-110 transition"
          aria-label="Tera captain"
        >
          C
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-surface-overlay border-border-default">
          <div className="text-[10px] space-y-1">
            <div className="font-semibold text-pink">Tera Captain</div>
            {teraTypes && teraTypes.length > 0 && (
              <div className="flex gap-1">
                {teraTypes.map(t => (
                  <span
                    key={t}
                    className="px-1 py-0.5 rounded text-[8px] font-bold uppercase text-white"
                    style={{ backgroundColor: TYPE_COLORS[t] ?? '#888' }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
