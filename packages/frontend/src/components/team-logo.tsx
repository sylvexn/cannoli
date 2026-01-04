import { cn } from '@/lib/utils';

interface TeamLogoProps {
  abbrev: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
};

export function TeamLogo({ abbrev, color, size = 'md', className }: TeamLogoProps) {
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
