import type { CSSProperties, ReactNode } from 'react';
import { blendHex } from '@/lib/color';

interface AccentSource {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
}

const FALLBACK = {
  primary: '#7dd3fc', // sky-300
  secondary: '#a78bfa', // violet-400
};

/**
 * Wraps children in a div whose CSS custom properties expose the user's accent
 * palette. Children can reference `var(--user-primary | --user-secondary | --user-tertiary)`.
 * Tertiary is optional — when absent we synthesize it as a 50/50 blend of
 * primary + secondary so palette consumers never deal with a third hue that
 * fights the team color.
 */
export function UserAccentScope({
  user,
  children,
  className,
  style,
}: {
  user?: AccentSource | null;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const primary = user?.primaryColor ?? FALLBACK.primary;
  const secondary = user?.secondaryColor ?? FALLBACK.secondary;
  const tertiary = user?.tertiaryColor ?? blendHex(primary, secondary);

  const accent: CSSProperties = {
    ['--user-primary' as any]: primary,
    ['--user-secondary' as any]: secondary,
    ['--user-tertiary' as any]: tertiary,
    ...style,
  };
  return (
    <div className={className} style={accent}>
      {children}
    </div>
  );
}
