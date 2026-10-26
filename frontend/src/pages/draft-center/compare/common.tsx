import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Side } from '@/lib/draft-center/compare';

export const SIDE_STYLE: Record<Side, { text: string; bg: string; border: string }> = {
  a: { text: 'text-sky-400', bg: 'bg-sky-400', border: 'border-sky-400/60' },
  b: { text: 'text-amber-400', bg: 'bg-amber-400', border: 'border-amber-400/60' },
};

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-raised/40 min-w-0">
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-surface-overlay/30">
        <h3 className="text-[11px] font-mono font-bold uppercase tracking-widest text-text-muted">{title}</h3>
        {hint && <span className="ml-auto text-[10px] text-text-muted">{hint}</span>}
      </header>
      <div className="p-3 min-w-0">{children}</div>
    </section>
  );
}

export const SideTag = ({ side, className }: { side: Side; className?: string }) => (
  <span className={cn('font-mono font-bold', SIDE_STYLE[side].text, className)}>{side.toUpperCase()}</span>
);
