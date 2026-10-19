import { useState } from 'react';
import { AlertTriangle, ChevronDown, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import type { DcMon, DcValidation } from '@/lib/draft-center/types';

/** Budget meter + roster/captain counters. Over-budget turns red but never blocks. */
export function BudgetMeter({ v, roster, ruleset }: { v: DcValidation; roster: DcMon[]; ruleset: Ruleset }) {
  const pct = Math.min(100, (v.used / Math.max(1, v.budget)) * 100);
  const over = v.used > v.budget;
  const near = !over && v.remaining <= Math.max(3, v.budget * 0.05);
  const captains = roster.filter(m => m.captain).length;
  return (
    <div className="rounded-lg border border-border-default bg-surface-raised/50 p-2.5 flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className={cn('text-2xl font-mono font-bold tabular-nums', over ? 'text-loss' : 'text-text-primary')}>{v.used}</span>
        <span className="text-sm font-mono text-text-muted">/ {v.budget} pts</span>
        <span className={cn('ml-auto text-xs font-mono tabular-nums', over ? 'text-loss' : near ? 'text-amber-400' : 'text-text-secondary')}>
          {over ? `${-v.remaining} over` : `${v.remaining} left`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-overlay overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={v.budget} aria-valuenow={v.used}>
        <div
          className={cn('h-full rounded-full transition-all', over ? 'bg-loss' : near ? 'bg-amber-400' : 'bg-neon')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono text-text-muted">
        <Counter label="Roster" value={`${v.count}/${v.rosterSize}`} bad={v.count > v.rosterSize} hint="Pokemon on the team / roster size" />
        <Counter label="Captains" value={`${captains}/${ruleset.teraCaptainSlots}`} bad={captains > ruleset.teraCaptainSlots} hint="Tera captains / slots allowed" />
        <span className="ml-auto truncate min-w-0" title={ruleset.label}>{ruleset.label}</span>
      </div>
    </div>
  );
}

function Counter({ label, value, bad, hint }: { label: string; value: string; bad: boolean; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default shrink-0" />}>
        {label} <span className={cn('tabular-nums', bad ? 'text-loss font-bold' : 'text-text-secondary')}>{value}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Inline rule violations: warnings are prominent, info nudges are muted. Collapsible. */
export function Violations({ v }: { v: DcValidation }) {
  const [open, setOpen] = useState(true);
  const warns = v.violations.filter(x => x.severity === 'warn');
  const infos = v.violations.filter(x => x.severity === 'info');

  if (v.violations.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-win px-1">
        <CheckCircle2 size={13} /> Legal under this ruleset
      </div>
    );
  }
  return (
    <div className={cn('rounded-lg border overflow-hidden', warns.length ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-border-default')}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left">
        {warns.length > 0
          ? <AlertTriangle size={13} className="text-amber-400 shrink-0" />
          : <Info size={13} className="text-text-muted shrink-0" />}
        <span className="text-xs font-semibold">
          {warns.length > 0 ? `${warns.length} rule warning${warns.length === 1 ? '' : 's'}` : 'Suggestions'}
          {infos.length > 0 && warns.length > 0 && <span className="text-text-muted font-normal"> + {infos.length} note{infos.length === 1 ? '' : 's'}</span>}
        </span>
        <span className="text-[10px] text-text-muted">can still be saved</span>
        <ChevronDown size={12} className={cn('ml-auto text-text-muted transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <ul className="px-2.5 pb-2 flex flex-col gap-0.5">
          {warns.map((x, i) => (
            <li key={`w${i}`} className="text-[11px] text-amber-300/90 flex gap-1.5"><span aria-hidden>-</span>{x.message}</li>
          ))}
          {infos.map((x, i) => (
            <li key={`i${i}`} className="text-[11px] text-text-muted flex gap-1.5"><span aria-hidden>-</span>{x.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
