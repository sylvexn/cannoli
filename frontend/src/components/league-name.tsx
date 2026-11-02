import { cn } from '@/lib/utils';

/** Faceted gem crest, filled with the league's gem color. */
export function GemCrest({ color, size = 16, className }: { color: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={cn('shrink-0', className)}>
      <path d="M12 2 21 8.5 17.5 21h-11L3 8.5z" fill={color} />
      <path d="M12 2 21 8.5 12 11 3 8.5z" fill="#fff" opacity=".35" />
      <path d="M12 11 17.5 21h-11z" fill="#000" opacity=".18" />
      <path d="M3 8.5 12 11 6.5 21z" fill="#fff" opacity=".12" />
    </svg>
  );
}

/** Crest + bold sans name. Used in menus, the switcher and compact spots. */
export function LeagueNameSans({ name, color, size = 14, className }: {
  name: string; color: string; size?: number; className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center leading-none', className)} style={{ gap: size * 0.35 }}>
      <GemCrest color={color} size={Math.round(size * 1.1)} />
      <span className="min-w-0 truncate font-extrabold text-text-primary" style={{ fontSize: size }}>{name}</span>
    </span>
  );
}

/** Broadcast name: crest + slanted heavy caps on a gem gradient stripe. */
export function LeagueStripe({ name, color, size = 22, crest = true, className }: {
  name: string; color: string; size?: number; crest?: boolean; className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center leading-none', className)} style={{ gap: size * 0.3 }}>
      {crest && <GemCrest color={color} size={Math.round(size * 1.15)} />}
      <span
        className="min-w-0 truncate font-stripe uppercase text-white"
        style={{
          fontSize: size * 0.9,
          transform: 'skewX(-8deg)',
          padding: `${size * 0.12}px ${size * 0.35}px`,
          background: `linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 0%, transparent) 92%)`,
        }}
      >
        {name}
      </span>
    </span>
  );
}

const PHASE_LABEL: Record<string, string> = {
  predraft: 'Pre-draft', draft: 'Draft', regular: 'Regular season', playoffs: 'Playoffs', offseason: 'Offseason',
};

/** "Season 11 · Week 4 of 11 · Regular season" */
export function leagueSubline(season: { seasonNumber: number; phase: string; currentWeek: number; totalWeeks: number }) {
  const parts = [`Season ${season.seasonNumber}`];
  if ((season.phase === 'regular' || season.phase === 'playoffs') && season.currentWeek > 0) {
    parts.push(season.totalWeeks ? `Week ${season.currentWeek} of ${season.totalWeeks}` : `Week ${season.currentWeek}`);
  }
  parts.push(PHASE_LABEL[season.phase] ?? season.phase);
  return parts.join(' · ');
}
