import { cn } from '@/lib/utils';

interface BudgetBarProps {
  used: number;
  cap: number;
  projected: number | null;
  teamColor: string;
  teamName: string;
}

export function BudgetBar({ used, cap, projected, teamColor, teamName }: BudgetBarProps) {
  const pctUsed = Math.min(100, (used / cap) * 100);
  const pctProj = projected != null ? Math.min(100, (projected / cap) * 100) : null;
  const overCap = projected != null && projected > cap;

  return (
    <div className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 shrink-0">
      <div className="flex items-center justify-between text-[11px] mb-1.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: teamColor }}
          />
          <span className="text-text-secondary font-medium">{teamName}</span>
        </div>
        <div className="font-mono tabular-nums text-text-muted">
          <span className={cn('font-semibold', overCap ? 'text-loss' : 'text-text-primary')}>
            {projected ?? used}
          </span>
          <span> / {cap}</span>
          {projected != null && projected !== used && (
            <span className="text-text-muted ml-1">(was {used})</span>
          )}
        </div>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${pctUsed}%`, backgroundColor: teamColor, opacity: 0.5 }}
        />
        {pctProj != null && (
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full transition-all',
              overCap ? 'bg-loss' : 'bg-neon',
            )}
            style={{ width: `${pctProj}%`, opacity: overCap ? 0.9 : 0.6 }}
          />
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon, title, message,
}: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[40vh] gap-3 text-center px-6">
      {icon}
      <div className="text-base font-semibold text-text-primary">{title}</div>
      <div className="text-sm text-text-muted max-w-md">{message}</div>
    </div>
  );
}
