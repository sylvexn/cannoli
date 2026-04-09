import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface CoachAvatarProps {
  username: string;
  displayName?: string | null;
  avatarPath?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  /** Pixel size (default: 24). Common: 16, 20, 24, 32, 48, 64. */
  size?: number;
  /** Show a thin accent ring around the avatar (default true). */
  ring?: boolean;
  className?: string;
  style?: CSSProperties;
}

const FALLBACK_PRIMARY = '#7dd3fc';   // sky-300
const FALLBACK_SECONDARY = '#a78bfa'; // violet-400

/**
 * Standalone coach avatar — image when present, otherwise a 2-color gradient
 * dot with the first letter of the username. Intended to be tiny and dense.
 */
export function CoachAvatar({
  username,
  displayName,
  avatarPath,
  primaryColor,
  secondaryColor,
  size = 24,
  ring = true,
  className,
  style,
}: CoachAvatarProps) {
  const primary = primaryColor ?? FALLBACK_PRIMARY;
  const secondary = secondaryColor ?? FALLBACK_SECONDARY;
  const initial = (displayName?.trim() || username || '?').charAt(0).toUpperCase();

  const ringStyle: CSSProperties = ring
    ? { boxShadow: `0 0 0 1.5px ${secondary}` }
    : {};

  const baseStyle: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.45)),
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
