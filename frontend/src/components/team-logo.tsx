import { cn } from '@/lib/utils';

interface TeamLogoProps {
  abbrev: string;
  color: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Relative path stored on the team (e.g. 'team-logos/sapphire-sas.png'). */
  logoPath?: string | null;
}

const sizeMap = {
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
  xl: 'w-24 h-24 text-2xl',
};

export function TeamLogo({ abbrev, color, size = 'md', className, logoPath }: TeamLogoProps) {
  if (logoPath) {
    const src = logoPath.startsWith('/') ? logoPath : `/uploads/${logoPath}`;
    return (
      <img
        src={src}
        alt={abbrev}
        className={cn('rounded-full object-cover', sizeMap[size], className)}
        style={{ border: `1.5px solid ${color}50` }}
      />
    );
  }
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-bold tracking-tight',
        sizeMap[size],
        className,
      )}
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1.5px solid ${color}50`,
      }}
    >
      {abbrev}
    </div>
  );
}
