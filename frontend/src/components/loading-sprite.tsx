import { cn } from '@/lib/utils';

interface LoadingSpriteProps {
  /** Status copy. Default 'Loading…'. */
  label?: string;
  /** Ball size. Default 'md'. */
  size?: 'sm' | 'md' | 'lg';
  /** Vertical padding. Default 'md'. */
  padding?: 'sm' | 'md' | 'lg';
  className?: string;
}

const PADDING_CLASS = { sm: 'py-3', md: 'py-6', lg: 'py-10' } as const;
const BALL_PX = { sm: 16, md: 22, lg: 28 } as const;

/** A small spinning Poke Ball (pure CSS). Exported for inline use. */
export function PokeBall({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('relative inline-block shrink-0 rounded-full motion-safe:animate-spin', className)}
      style={{
        width: size,
        height: size,
        animationDuration: '1s',
        animationTimingFunction: 'cubic-bezier(.5,.1,.5,.9)',
        background: 'linear-gradient(#e5484d 0 44%, #16181d 44% 56%, #e9ebef 56%)',
      }}
    >
      <span
        className="absolute rounded-full bg-[#e9ebef]"
        style={{ inset: size * 0.32, boxShadow: '0 0 0 2px #16181d' }}
      />
    </span>
  );
}

/** Loading indicator (1.4): a Poke Ball spinner with a short message. */
export function LoadingSprite({ label = 'Loading…', size = 'md', padding = 'md', className }: LoadingSpriteProps) {
  return (
    <div
      className={cn('flex items-center justify-center gap-2.5', PADDING_CLASS[padding], className)}
      role="status"
      aria-live="polite"
    >
      <PokeBall size={BALL_PX[size]} />
      <span className="text-sm text-text-muted">{label}</span>
    </div>
  );
}
