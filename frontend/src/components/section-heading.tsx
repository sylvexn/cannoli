import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionHeadingProps {
  children: ReactNode;
  /** Small muted count/qualifier after the title, e.g. "12 teams". */
  meta?: ReactNode;
  /** Right-aligned action (usually a link). */
  action?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}

/** 1.4 open-section heading: medium-weight text, gem-tinted, with a hairline
 *  running to the edge. Replaces bordered card headers. */
export function SectionHeading({ children, meta, action, as: Tag = 'h2', className }: SectionHeadingProps) {
  return (
    <div className={cn('flex items-center gap-2.5 min-h-[22px] mb-1.5', className)}>
      <Tag className="text-sm font-semibold font-sans text-[color-mix(in_oklab,var(--gem-ink)_35%,var(--color-text-primary))] shrink-0">
        {children}
      </Tag>
      {meta != null && <span className="text-xs text-text-muted shrink-0">{meta}</span>}
      <span className="h-px flex-1 bg-border-subtle" aria-hidden />
      {action != null && <span className="shrink-0 text-xs text-text-muted [&_a:hover]:text-text-primary [&_button:hover]:text-text-primary">{action}</span>}
    </div>
  );
}
