import { useState, type ReactNode, type KeyboardEvent } from 'react';
import { Eye } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

/**
 * Spoiler veil for match results.
 *
 * When the viewer has spoiler-free mode OFF (the default), children render
 * untouched — zero visual or layout change. When it's ON, children are blurred
 * and the element becomes a click-to-reveal target; revealing is ephemeral
 * (local state), so navigating away or reloading re-hides the result. This is
 * the desired protection: results stay hidden until the user deliberately opts
 * to peek at each one.
 *
 * Used to wrap scores, win/loss highlighting, and result badges on the
 * standings and replays pages. Keep it granular — wrap the result-bearing bits,
 * not whole rows, so the rest of the page stays browsable while hidden.
 */
export function Spoiler({
  children,
  className,
  as = 'span',
  label = 'Spoiler — click to reveal',
}: {
  children: ReactNode;
  className?: string;
  /** Wrapper element. 'span' (default) for inline result text, 'div' for blocks. */
  as?: 'span' | 'div';
  /** Accessible label / tooltip shown over the blurred content. */
  label?: string;
}) {
  const { spoilerFreeMode } = useAuth();
  const [revealed, setRevealed] = useState(false);

  // Feature off, or already peeked — render the real content with no wrapper cost.
  if (!spoilerFreeMode || revealed) return <>{children}</>;

  const Tag = as;
  const reveal = () => setRevealed(true);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      reveal();
    }
  };

  return (
    <Tag
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={reveal}
      onKeyDown={onKey}
      className={cn(
        'relative inline-flex items-center justify-center cursor-pointer align-middle rounded',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        className,
      )}
    >
      {/* Real content, blurred + inert so it can't be read or interacted with. */}
      <span aria-hidden className="blur-[5px] select-none pointer-events-none opacity-70 saturate-50">
        {children}
      </span>
      {/* Reveal hint centered over the blur. */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center text-text-muted/90"
      >
        <Eye className="h-3.5 w-3.5" />
      </span>
    </Tag>
  );
}
