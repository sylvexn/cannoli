import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ApiAdminMatch } from '@/lib/api';
import {
  AlertTriangle, CheckCircle2, Clock, Swords, Shield,
} from 'lucide-react';

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  scheduled: { label: 'Scheduled', color: 'text-text-muted border-border-subtle', icon: Clock },
  ready: { label: 'Ready', color: 'text-draw border-draw/30 bg-draw/10', icon: Shield },
  in_progress: { label: 'Live', color: 'text-neon border-neon/30 bg-neon/10', icon: Swords },
  completed: { label: 'Completed', color: 'text-win border-win/30 bg-win/10', icon: CheckCircle2 },
  disputed: { label: 'Disputed', color: 'text-loss border-loss/30 bg-loss/10', icon: AlertTriangle },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.scheduled;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 gap-1', cfg.color)}>
      <Icon size={10} />
      {cfg.label}
    </Badge>
  );
}

export function WarningCountBadge({ count }: { count: number }) {
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-draw border-draw/30 bg-draw/10 gap-1">
      <AlertTriangle size={10} />
      {count}
    </Badge>
  );
}

export function PhaseBadge({ match }: { match: ApiAdminMatch }) {
  if (match.phase !== 'playoffs') return null;
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-pink border-pink/30">
      {match.playoffRound?.toUpperCase()}
    </Badge>
  );
}

/** Returns true when a match needs an admin's eyes: warnings present, a
 *  dispute, or a not-yet-recorded scheduled/ready match. */
export function matchNeedsAttention(m: ApiAdminMatch): boolean {
  if (m.warnings.length > 0) return true;
  if (m.status === 'disputed') return true;
  if ((m.status === 'scheduled' || m.status === 'ready') && m.homeScore === null) return true;
  return false;
}

/** Returns true when a match is fully done with nothing outstanding. */
export function matchIsSettled(m: ApiAdminMatch): boolean {
  return m.status === 'completed' && m.warnings.length === 0;
}

/** Compact per-week tally: completed / pending / disputed / warnings. */
export function WeekSummary({ matches }: { matches: ApiAdminMatch[] }) {
  const completed = matches.filter(m => m.status === 'completed').length;
  const disputed = matches.filter(m => m.status === 'disputed').length;
  const warnings = matches.filter(m => m.warnings.length > 0).length;
  const pending = matches.filter(
    m => (m.status === 'scheduled' || m.status === 'ready') && m.homeScore === null,
  ).length;

  return (
    <span className="flex items-center gap-2.5 font-mono normal-case tracking-normal">
      {completed > 0 && (
        <span className="flex items-center gap-0.5 text-win" title="Completed">
          <CheckCircle2 size={11} />
          {completed}
        </span>
      )}
      {pending > 0 && (
        <span className="flex items-center gap-0.5 text-text-muted" title="Pending result">
          <Clock size={11} />
          {pending}
        </span>
      )}
      {disputed > 0 && (
        <span className="flex items-center gap-0.5 text-loss" title="Disputed">
          <AlertTriangle size={11} />
          {disputed}
        </span>
      )}
      {warnings > 0 && (
        <span className="flex items-center gap-0.5 text-draw" title="With warnings">
          <Shield size={11} />
          {warnings}
        </span>
      )}
    </span>
  );
}
