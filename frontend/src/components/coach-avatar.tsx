import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface CoachAvatarProps {
  username: string;
  displayName?: string | null;
  avatarPath?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  /**
   * Named size scale — preferred over raw pixels. The scale is tuned for
   * specific surfaces:
   *  - `xs`  16px  — inline mentions, dense table cells
   *  - `sm`  20px  — chat lines, sidebar dropdown trigger
   *  - `md`  28px  — standings rows, sidebar footer, inline lists
   *  - `lg`  36px  — activity feeds, hover-card banner avatars
   *  - `xl`  56px  — secondary profile blocks
   *  - `2xl` 88px  — primary profile header
   *
   * Pass a raw number to override; numbers still work for one-off cases.
   * Default: `md` (28px) — bumped up from the old 24 to give people more
   * presence everywhere they appear.
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | number;
  /** Show a thin accent ring around the avatar (default true). */
  ring?: boolean;
  /**
   * Optional presence indicator — adds a colored 2px outer ring on top of
   * the accent ring. Purely a styling slot; no backend wiring yet.
   */
  presence?: 'online' | 'away' | 'in-draft';
  /**
   * Optional outer ring color. When set, renders a 2px outer ring at the
   * given color — used to surface the active team color on the coach
   * profile when the user is currently coaching. Suppressed if `presence`
   * is set (presence is more time-sensitive).
   */
  ringColor?: string | null;
  className?: string;
  style?: CSSProperties;
}

const FALLBACK_PRIMARY = '#7dd3fc';   // sky-300
const FALLBACK_SECONDARY = '#a78bfa'; // violet-400

/** Named size scale → pixels. See prop docs for surface mapping. */
const SIZE_SCALE: Record<Exclude<CoachAvatarProps['size'] & string, never>, number> = {
  xs: 16,
  sm: 20,
  md: 28,
  lg: 36,
  xl: 56,
  '2xl': 88,
};

const PRESENCE_COLORS: Record<NonNullable<CoachAvatarProps['presence']>, string> = {
  online: '#4ade80',   // green
  away: '#fbbf24',     // amber
  'in-draft': '#22d3ee', // cyan / neon
};

function resolveSize(size: CoachAvatarProps['size']): number {
  if (typeof size === 'number') return size;
  if (size && size in SIZE_SCALE) return SIZE_SCALE[size];
  return SIZE_SCALE.md;
}

/**
 * Standalone coach avatar — image when present, otherwise a 2-color gradient
 * dot with the first letter of the username. The named size scale lets every
 * surface request the right presence: tiny for chat/inline, big for profiles.
 */
export function CoachAvatar({
  username,
  displayName,
  avatarPath,
  primaryColor,
  secondaryColor,
  size = 'md',
  ring = true,
  presence,
  ringColor,
  className,
  style,
}: CoachAvatarProps) {
  const primary = primaryColor ?? FALLBACK_PRIMARY;
  const secondary = secondaryColor ?? FALLBACK_SECONDARY;
  const initial = (displayName?.trim() || username || '?').charAt(0).toUpperCase();
  const px = resolveSize(size);

  // Ring stack: outer slot is presence > ringColor (mutually exclusive —
  // presence is more time-sensitive than the identity-color flair). Inner
  // slot is the accent ring derived from the user's secondary color. All
  // share one box-shadow chain so we don't need an extra DOM node.
  const shadows: string[] = [];
  if (ring) shadows.push(`0 0 0 1.5px ${secondary}`);
  if (presence) {
    shadows.push(`0 0 0 ${ring ? 3.5 : 2}px ${PRESENCE_COLORS[presence]}`);
  } else if (ringColor) {
    shadows.push(`0 0 0 ${ring ? 3 : 1.5}px ${ringColor}`);
  }
  const ringStyle: CSSProperties = shadows.length
    ? { boxShadow: shadows.join(', ') }
    : {};

  const baseStyle: CSSProperties = {
    width: px,
    height: px,
    fontSize: Math.max(9, Math.round(px * 0.45)),
    ...ringStyle,
    ...style,
  };

  if (avatarPath) {
    return (
      <img
        src={avatarPath}
        alt={`${displayName ?? username} avatar`}
        loading="lazy"
        className={cn(
          'rounded-full object-cover shrink-0 select-none',
          className,
        )}
        style={baseStyle}
        draggable={false}
      />
    );
  }

  return (
    <span
      aria-label={`${displayName ?? username} avatar`}
      className={cn(
        'rounded-full inline-flex items-center justify-center font-bold shrink-0 select-none',
        className,
      )}
      style={{
        ...baseStyle,
        background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
        color: '#0a0a14',
        textShadow: '0 1px 1px rgba(255,255,255,0.2)',
      }}
    >
      {initial}
    </span>
  );
}
