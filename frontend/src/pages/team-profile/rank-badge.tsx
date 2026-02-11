export function RankBadge({ rank, size = 'md' }: { rank: number; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-10 h-10 text-base';

  if (rank <= 3) {
    return (
      <div className={`rank-badge rank-badge-${rank} ${sz}`}>
        {rank}
      </div>
    );
  }

  if (rank <= 8) {
    return (
      <div className={`${sz} rounded-full bg-neon/10 border border-neon/20 flex items-center justify-center font-bold tabular-nums text-neon`}>
        {rank}
      </div>
    );
  }

  return (
    <div className={`${sz} rounded-full bg-surface-overlay border border-border-subtle flex items-center justify-center font-bold tabular-nums text-text-muted`}>
      {rank}
    </div>
  );
}
