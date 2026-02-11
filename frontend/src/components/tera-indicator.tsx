import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { PokemonType } from '@/lib/pokemon';
import { TYPE_COLORS } from '@/lib/constants';

interface TeraIndicatorProps {
  /** Pokemon display name — rendered in pink when tera captain */
  name: string;
  isTeraCaptain: boolean;
  teraTypes?: PokemonType[];
  className?: string;
}


/**
 * Displays a Pokemon name with tera captain styling.
 * - Tera captains: name in pink + "T" badge that shows tera types on hover
 * - Non-captains: name in default color, no badge
 */
export function TeraIndicator({ name, isTeraCaptain, teraTypes, className }: TeraIndicatorProps) {
  if (!isTeraCaptain) {
    return <span className={cn('text-text-primary', className)}>{name}</span>;
  }

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="text-pink">{name}</span>
      <Tooltip>
        <TooltipTrigger
          className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-pink/20 text-pink text-[8px] font-black leading-none border border-pink/40 cursor-default hover:bg-pink/30 transition-colors"
        >
          T
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
