/**
 * Shared chrome for the Usage dashboard panels — same Card + icon-header
 * pattern as the Observability panels (health-panel / trends-panel).
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface PanelProps {
  icon: LucideIcon;
  title: string;
  iconClass?: string;
  /** Right-aligned header controls (toggles, badges, refresh). */
  right?: ReactNode;
  children: ReactNode;
}

export function Panel({ icon: Icon, title, iconClass = 'text-neon', right, children }: PanelProps) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <Icon size={13} className={iconClass} />
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">{title}</span>
          {right && <div className="ml-auto flex items-center gap-1">{right}</div>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function PanelEmpty({ label }: { label: string }) {
  return <p className="text-xs text-text-muted py-3 text-center">{label}</p>;
}

export function RefreshButton({ onClick, spinning, title }: { onClick: () => void; spinning: boolean; title: string }) {
  return (
    <Button
      variant="ghost" size="sm"
      onClick={onClick}
      className="h-6 w-6 p-0 text-text-muted hover:text-text-primary"
      title={title}
    >
      <RefreshCw size={11} className={spinning ? 'animate-spin' : ''} />
    </Button>
  );
}

/**
 * Dense metric row with a subtle proportional background bar (views vs the
 * table max) so magnitude is scannable without a separate chart.
 */
interface BarRowProps {
  /** 0–100 width of the background bar. */
  pct: number;
  children: ReactNode;
}

export function BarRow({ pct, children }: BarRowProps) {
  return (
    <div className="relative flex items-center gap-2 rounded px-1.5 py-1 text-[11px] overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 rounded bg-neon/10"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        aria-hidden
      />
      {children}
    </div>
  );
}
