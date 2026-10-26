import { Bug, Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TicketStatus } from '@/lib/api-tickets';

export const STATUS_META: Record<TicketStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'border-neon/40 text-neon' },
  triaged: { label: 'Triaged', cls: 'border-cyan-500/40 text-cyan-400' },
  in_progress: { label: 'In progress', cls: 'border-draw/40 text-draw' },
  fixed: { label: 'Fixed', cls: 'border-win/40 text-win' },
  wont_fix: { label: "Won't fix", cls: 'border-border-default text-text-muted' },
};

export const selectCls = 'h-8 rounded-md border border-border-default bg-surface-base px-2 text-[12px]';

export function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <Badge variant="outline" className={cn('text-[10px] font-mono uppercase tracking-wide px-1.5 py-0 h-4', className)}>{children}</Badge>;
}

export function TypeIcon({ t }: { t: 'bug' | 'idea' }) {
  return t === 'bug' ? <Bug size={12} className="text-loss shrink-0" /> : <Lightbulb size={12} className="text-neon shrink-0" />;
}
