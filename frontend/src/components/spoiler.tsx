import { useState, type ReactNode, type KeyboardEvent } from 'react';
import { Eye } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

/**
 * Spoiler veil for match results.
 *
 * When the viewer has spoiler-free mode OFF, children render untouched — zero
 * visual or layout change. When it's ON (the default), children are blurred and
 * the element becomes a click-to-reveal target.
 *
 * Reveal model — pass `matchId` (a match's stable id, e.g. 'sapphire-w1m1') and
 * revealing is PERSISTED per user: clicking reveals THAT match and the reveal
 * survives reloads / syncs across devices (stored server-side). Any user can
 * always peek a specific battle — this is NOT admin-gated. Without `matchId` the
 * reveal falls back to ephemeral local state (re-hides on reload) for callers
 * that lack a match key.
 *
 * Used to wrap scores, win/loss highlighting, and result badges on the schedule
 * and replays pages. Keep it granular — wrap the result-bearing bits, not whole
 * rows, so the rest of the page stays browsable while hidden.
 *
 * Note: standings, the homepage top-6, and the stats/coach surfaces no longer
 * use this — those are gated SERVER-SIDE on the admin publish line and render
 * whatever the backend sends (no per-user blur).
 */
export function Spoiler({
  children,
  className,
  as = 'span',
  label = 'Spoiler — click to reveal',
  matchId,
}: {
  children: ReactNode;
  className?: string;
  /** Wrapper element. 'span' (default) for inline result text, 'div' for blocks. */
  as?: 'span' | 'div';
  /** Accessible label / tooltip shown over the blurred content. */
  label?: string;
  /** Stable match id. When set, reveal is persisted per user across reloads. */
  matchId?: string;
}) {
  const { spoilerFreeMode, spoilerRevealedMatches, revealMatch } = useAuth();
  const [localRevealed, setLocalRevealed] = useState(false);

  const Tag = as;

  const perMatch = !!matchId;
  const revealed = perMatch
    ? spoilerRevealedMatches.includes(matchId)
    : localRevealed;

  // Feature off, or already peeked — render the real content with no wrapper cost.
  if (!spoilerFreeMode || revealed) return <>{children}</>;

  const reveal = () => {
    if (perMatch) revealMatch(matchId);
    else setLocalRevealed(true);
  };
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
        className="absolute inset-0 flex items-center justify-center text-text-muted"
      >
        <Eye className="h-3.5 w-3.5" />
      </span>
    </Tag>
  );
}
