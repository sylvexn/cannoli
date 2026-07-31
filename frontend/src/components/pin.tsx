import { memo } from 'react';
import * as LucideIcons from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatPinMetadata } from '@/lib/pin-metadata-schema';

/**
 * Definition shape returned by /api/admin/pin-definitions and embedded in
 * /api/users/:username/pins responses. Kept as a structural type so callers
 * can pass the lighter "ApiPinDefinition" shape from api.ts without coupling.
 */
export interface PinDefinitionLike {
  id: string;
  name: string;
  description?: string | null;
  iconName: string;
  color: string;
  category?: string | null;
}

export type PinSize = 'xs' | 'sm' | 'lg';

interface PinProps {
  def: PinDefinitionLike;
  /** xs (12px inline icon), sm (24px circular), lg (48px trophy w/ glint). */
  size?: PinSize;
  /** Season the pin was earned in — rendered as "Earned S{n}" in the detail
   *  card when present. Pin contexts no longer surface relative-time strings. */
  seasonId?: number | null;
  /** League the pin is filed against (pins.leagueId, not metadata) — needed
   *  to turn team references inside the metadata detail into real links. */
  leagueId?: string | null;
  /** Award metadata blob (pokemon/nickname/teamId/kills/etc.) — rendered per
   *  the per-pin schema in `lib/pin-metadata-schema.tsx`. */
  metadata?: Record<string, unknown> | null;
  className?: string;
  /** Hide the detail card wrapper (e.g., when the parent already provides one). */
  noTooltip?: boolean;
}

// Lucide ships with hundreds of icons; we look them up by string name with a
// safe fallback. All sizes share this lookup so renaming the def to a new
// icon picks up immediately without code changes.
type LucideIconComponent = React.ComponentType<{ size?: number | string; className?: string; color?: string; strokeWidth?: number }>;
const LUCIDE_MAP = LucideIcons as unknown as Record<string, LucideIconComponent>;

function resolveIcon(name: string): LucideIconComponent {
  return LUCIDE_MAP[name] ?? LUCIDE_MAP.Award ?? LUCIDE_MAP.Trophy!;
}

export const Pin = memo(function Pin({
  def, size = 'sm', seasonId, leagueId, metadata, className, noTooltip,
}: PinProps) {
  const Icon = resolveIcon(def.iconName);
  const color = def.color || '#fbbf24';

  let body: React.ReactNode;

  if (size === 'xs') {
    // Inline 12px icon — no ring, no background. Used next to a username.
    body = (
      <span
        className={cn('inline-flex items-center justify-center', className)}
        aria-label={def.name}
      >
        <Icon size={12} color={color} strokeWidth={2.25} />
      </span>
    );
  } else if (size === 'sm') {
    // 24px circular badge with a faint accent ring + tinted background.
    body = (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full',
          'h-6 w-6 ring-1 transition-shadow',
          className,
        )}
        style={{
          background: `${color}1f`, // 12% opacity hex suffix
          // Tailwind's ring-color via inline style
          boxShadow: `inset 0 0 0 1px ${color}66`,
        }}
        aria-label={def.name}
      >
        <Icon size={13} color={color} strokeWidth={2.25} />
      </span>
    );
  } else {
    // 48px trophy: gradient backdrop + glint sweep on hover (.pin-glint
    // is defined in index.css; reused, not redefined).
    body = (
      <span
        className={cn(
          'pin-glint inline-flex items-center justify-center rounded-full',
          'h-12 w-12 relative',
          className,
        )}
        style={{
          background: `radial-gradient(circle at 30% 25%, ${color}33 0%, ${color}10 55%, transparent 80%)`,
          boxShadow: `inset 0 0 0 2px ${color}99, 0 0 16px -4px ${color}44`,
        }}
        aria-label={def.name}
      >
        <Icon size={24} color={color} strokeWidth={2.25} />
      </span>
    );
  }

  if (noTooltip) return body;

  // Popover (not Tooltip) — the metadata detail can contain real links
  // (Pokemon / team), and hover-only Tooltips can't host clickable content.
  // Mirrors the openOnHover pattern used by TeamLink/PokemonLink/CoachLink.
  return (
    <Popover>
      <PopoverTrigger
        nativeButton={false}
        openOnHover
        delay={300}
        closeDelay={120}
        render={<span className="inline-flex cursor-default" />}
      >
        {body}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        className="w-auto max-w-[240px] gap-0.5 p-2.5"
      >
        <PinDetailBody def={def} seasonId={seasonId} leagueId={leagueId} metadata={metadata} />
      </PopoverContent>
    </Popover>
  );
});

function PinDetailBody({
  def, seasonId, leagueId, metadata,
}: {
  def: PinDefinitionLike;
  seasonId?: number | null;
  leagueId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const detail = formatPinMetadata(def.id, metadata ?? null, leagueId);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-[11px] font-bold uppercase tracking-wide" style={{ color: def.color }}>
        {def.name}
      </div>
      {def.description && (
        <div className="text-[11px] leading-snug text-text-secondary">{def.description}</div>
      )}
      {detail != null && (
        <div className="text-[11px] leading-snug text-text-secondary italic">{detail}</div>
      )}
      {seasonId != null && (
        <div className="text-[10px] text-text-muted mt-0.5">Earned S{seasonId}</div>
      )}
    </div>
  );
}
