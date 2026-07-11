/**
 * StatTiles — the headline row of the Usage dashboard: Live now, Views today,
 * Visitors today, WAU, MAU. Same typographic scale as the API Logs stats
 * strip / TrendsPanel summary numbers.
 */
import type { LucideIcon } from 'lucide-react';
import { Radio, Eye, Users, CalendarRange, CalendarClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ApiAnalyticsSummary } from '@/lib/api';

interface StatTilesProps {
  tiles: ApiAnalyticsSummary['tiles'] | null;
  loading: boolean;
}

interface TileSpec {
  key: keyof ApiAnalyticsSummary['tiles'];
  label: string;
  icon: LucideIcon;
  hint: string;
}

const TILES: TileSpec[] = [
  { key: 'liveNow',       label: 'Live now',       icon: Radio,         hint: 'Distinct visitors active in the last 5 minutes' },
  { key: 'viewsToday',    label: 'Views today',    icon: Eye,           hint: 'Pageviews since midnight UTC' },
  { key: 'visitorsToday', label: 'Visitors today', icon: Users,         hint: 'Distinct visitors since midnight UTC' },
  { key: 'wau',           label: 'WAU',            icon: CalendarRange, hint: 'Weekly active users (last 7 days)' },
  { key: 'mau',           label: 'MAU',            icon: CalendarClock, hint: 'Monthly active users (last 30 days)' },
];

export function StatTiles({ tiles, loading }: StatTilesProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
      {TILES.map(({ key, label, icon: Icon, hint }) => {
        const value = tiles ? tiles[key] : null;
        const isLive = key === 'liveNow';
        const liveActive = isLive && (value ?? 0) > 0;
        return (
          <Card key={key} title={hint}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted">
                <Icon size={11} className={cn('shrink-0', liveActive && 'text-win')} />
                <span className="truncate">{label}</span>
                {liveActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-win animate-pulse shrink-0" aria-hidden />
                )}
              </div>
              <div className={cn(
                'mt-1 font-mono text-xl font-semibold tabular-nums',
                liveActive ? 'text-win' : 'text-text-primary',
              )}>
                {value != null ? value.toLocaleString() : loading ? '…' : '—'}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
