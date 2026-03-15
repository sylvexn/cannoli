import type { CSSProperties, ReactNode } from 'react';

interface AccentSource {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
}

const FALLBACK = {
  primary: '#7dd3fc', // sky-300
  secondary: '#a78bfa', // violet-400
  tertiary: '#fb7185', // rose-400
};

/**
 * Wraps children in a div whose CSS custom properties expose the user's accent
 * palette. Children can reference `var(--user-primary | --user-secondary | --user-tertiary)`.
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
  const accent: CSSProperties = {
    ['--user-primary' as any]: user?.primaryColor ?? FALLBACK.primary,
    ['--user-secondary' as any]: user?.secondaryColor ?? FALLBACK.secondary,
    ['--user-tertiary' as any]: user?.tertiaryColor ?? FALLBACK.tertiary,
    ...style,
  };
  return (
    <div className={className} style={accent}>
      {children}
    </div>
  );
}
