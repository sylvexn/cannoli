import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LoadingSprite } from '@/components/loading-sprite';

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b border-border-subtle">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <Skeleton className="h-4 w-full bg-surface-overlay/50" />
        </td>
      ))}
    </tr>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('bg-surface-raised border-border-default', className)}>
      <CardHeader className="pb-3">
        <Skeleton className="h-4 w-32 bg-surface-overlay/50" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-3 w-full bg-surface-overlay/50" />
        <Skeleton className="h-3 w-3/4 bg-surface-overlay/50" />
        <Skeleton className="h-3 w-1/2 bg-surface-overlay/50" />
      </CardContent>
    </Card>
  );
}

export function MatchCardSkeleton() {
  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      <CardContent className="p-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {/* Home team */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full bg-surface-overlay/50" />
            <Skeleton className="h-4 w-16 bg-surface-overlay/50" />
          </div>
          {/* Score / vs */}
          <Skeleton className="h-5 w-12 bg-surface-overlay/50" />
          {/* Away team */}
          <div className="flex items-center gap-2 justify-end">
            <Skeleton className="h-4 w-16 bg-surface-overlay/50" />
            <Skeleton className="h-8 w-8 rounded-full bg-surface-overlay/50" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function RosterRowSkeleton() {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border-subtle">
      {/* Sprite */}
      <Skeleton className="h-6 w-6 rounded bg-surface-overlay/50 shrink-0" />
      {/* Name */}
      <Skeleton className="h-3.5 w-24 bg-surface-overlay/50 flex-1" />
      {/* Type chips */}
      <Skeleton className="h-4 w-14 rounded-full bg-surface-overlay/50" />
      {/* Tier */}
      <Skeleton className="h-5 w-5 rounded bg-surface-overlay/50" />
      {/* K/D */}
      <Skeleton className="h-3 w-12 bg-surface-overlay/50" />
    </div>
  );
}

export function StatsTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-3 py-2 w-10"><Skeleton className="h-3 w-4 mx-auto bg-surface-overlay/50" /></th>
                <th className="w-8"><Skeleton className="h-6 w-6 rounded bg-surface-overlay/50" /></th>
                <th className="px-2 py-2"><Skeleton className="h-3 w-16 bg-surface-overlay/50" /></th>
                <th className="px-2 py-2"><Skeleton className="h-3 w-12 bg-surface-overlay/50" /></th>
                {['w-12', 'w-10', 'w-10', 'w-12', 'w-10', 'w-12', 'w-16'].map((w, i) => (
                  <th key={i} className="px-2 py-2"><Skeleton className={cn('h-3', w, 'ml-auto bg-surface-overlay/50')} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  <td className="px-3 py-2"><Skeleton className="h-4 w-4 mx-auto bg-surface-overlay/50" /></td>
                  <td className="py-2"><Skeleton className="h-6 w-6 rounded bg-surface-overlay/50" /></td>
                  <td className="px-2 py-2">
                    <div className="space-y-1">
                      <Skeleton className="h-3.5 w-20 bg-surface-overlay/50" />
                      <Skeleton className="h-2.5 w-14 bg-surface-overlay/50" />
                    </div>
                  </td>
                  <td className="px-2 py-2"><Skeleton className="h-4 w-14 rounded-full bg-surface-overlay/50" /></td>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-2 py-2">
                      <Skeleton className="h-3.5 w-8 ml-auto bg-surface-overlay/50" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function StandingsTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <Card className="lg:col-span-2 bg-surface-raised border-border-default">
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-24 bg-surface-overlay/50" />
      </CardHeader>
      <CardContent className="p-0">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle">
            {/* Rank */}
            <Skeleton className="h-5 w-5 rounded bg-surface-overlay/50 shrink-0" />
            {/* Team logo + name */}
            <div className="flex items-center gap-2.5 flex-1">
              <Skeleton className="h-7 w-7 rounded-full bg-surface-overlay/50" />
              <div className="space-y-1">
                <Skeleton className="h-3.5 w-24 bg-surface-overlay/50" />
                <Skeleton className="h-2.5 w-16 bg-surface-overlay/50" />
              </div>
            </div>
            {/* Record */}
            <Skeleton className="h-4 w-16 bg-surface-overlay/50" />
            {/* Chevron */}
            <Skeleton className="h-3 w-3 bg-surface-overlay/50" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function MatchListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-20 bg-surface-overlay/50" />
          <Skeleton className="h-5 w-16 rounded-full bg-surface-overlay/50" />
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center py-2 px-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full bg-surface-overlay/50" />
              <Skeleton className="h-3.5 w-10 bg-surface-overlay/50" />
            </div>
            <Skeleton className="h-3 w-6 mx-3 bg-surface-overlay/50" />
            <div className="flex items-center gap-2 justify-end">
              <Skeleton className="h-3.5 w-10 bg-surface-overlay/50" />
              <Skeleton className="h-6 w-6 rounded-full bg-surface-overlay/50" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function TeamProfileSkeleton() {
  return (
    <div className="space-y-6">
      {/* Back link */}
      <Skeleton className="h-4 w-28 bg-surface-overlay/50" />

      {/* Header */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full bg-surface-overlay/50" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-6 w-48 bg-surface-overlay/50" />
          <Skeleton className="h-4 w-32 bg-surface-overlay/50" />
        </div>
        <Skeleton className="h-8 w-20 bg-surface-overlay/50" />
      </div>

      {/* Stats row */}
      <div className="flex gap-4">
        <Skeleton className="h-5 w-20 bg-surface-overlay/50" />
        <Skeleton className="h-5 w-32 bg-surface-overlay/50" />
        <Skeleton className="h-5 w-24 bg-surface-overlay/50" />
      </div>

      {/* Roster rows */}
      <Card className="bg-surface-raised border-border-default p-4">
        <div className="space-y-0">
          {Array.from({ length: 10 }).map((_, i) => (
            <RosterRowSkeleton key={i} />
          ))}
        </div>
      </Card>
    </div>
  );
}

export function TradeBlockSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function PageLoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <LoadingSprite size="lg" padding="lg" />
    </div>
  );
}
