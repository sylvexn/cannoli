import { cn } from '@/lib/utils';

interface RecordDisplayProps {
  wins: number;
  losses: number;
  differential?: number;
  className?: string;
}

export function RecordDisplay({ wins, losses, differential, className }: RecordDisplayProps) {
  const diff = differential ?? (wins - losses);
  return (
    <span className={cn('tabular-nums font-medium', className)}>
      <span className="text-win">{wins}</span>
      <span className="text-text-muted">-</span>
      <span className="text-loss">{losses}</span>
      {diff !== 0 && (
        <span className={cn('ml-1 text-sm', diff > 0 ? 'text-win' : 'text-loss')}>
          ({diff > 0 ? '+' : ''}{diff})
        </span>
      )}
    </span>
  );
}
