import { cn } from '@/lib/utils';

interface KDDisplayProps {
  kills: number;
  deaths: number;
  className?: string;
}

export function KDDisplay({ kills, deaths, className }: KDDisplayProps) {
  const diff = kills - deaths;
  return (
    <span className={cn('tabular-nums text-sm', className)}>
      <span className="text-win">{kills}</span>
      <span className="text-text-muted">/</span>
      <span className="text-loss">{deaths}</span>
      <span className={cn('ml-1', diff > 0 ? 'text-win' : diff < 0 ? 'text-loss' : 'text-text-muted')}>
        {diff > 0 ? '+' : ''}{diff}
      </span>
    </span>
  );
}
