import { getAbilityDesc } from '@/lib/abilities';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface AbilityChipProps {
  name: string;
}

export function AbilityChip({ name }: AbilityChipProps) {
  const desc = getAbilityDesc(name);
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center px-1.5 py-[2px] rounded bg-surface-overlay/60 text-[9px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors cursor-default leading-tight">
          {name}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-surface-overlay border-border-default max-w-[220px]">
        <div className="text-[10px]">
          <span className="font-semibold text-text-primary">{name}</span>
          <p className="text-text-secondary mt-0.5 leading-snug">{desc}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
