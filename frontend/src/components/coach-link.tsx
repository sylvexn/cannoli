import { useState, useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CoachAvatar } from '@/components/coach-avatar';
import { TeamLogo } from '@/components/team-logo';
import { api, type ApiPublicProfile, type ApiPin } from '@/lib/api';
import { Pin } from '@/components/pin';
import { formatRecord, formatTenure } from '@/lib/format';
import { blendHex, readableOnDark } from '@/lib/color';
import { cn } from '@/lib/utils';
import { ChevronRight, Shield, Code2 } from 'lucide-react';

/** Named avatar size scale shared with CoachAvatar. Re-exported for callers
 *  that want to align with the design tokens without importing two files. */
type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | number;

const FALLBACK_PRIMARY = '#7dd3fc';
const FALLBACK_SECONDARY = '#a78bfa';

/** Minimal data caller passes; everything optional except `username`. */
export interface CoachRef {
  username: string;
  displayName?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
  avatarPath?: string | null;
  role?: 'dev' | 'admin' | 'user' | null;
}

interface CoachLinkProps {
  coach: CoachRef;
  /** Show the avatar inline before the name. */
  showAvatar?: boolean;
  /** Avatar size when showAvatar is true. Accepts the named scale (`xs`–`2xl`)
   *  or a raw pixel number. Default `xs` (16px) — meant for inline pills.
   *  Use `md`/`lg` for activity feeds and standings rows. */
  avatarSize?: AvatarSize;
  /** Optional presence indicator passed straight to the avatar. */
  presence?: 'online' | 'away' | 'in-draft';
  /** Render only the avatar (no name text). Useful for tight chips. */
  avatarOnly?: boolean;
  /** Disable the hover card (still renders the link). */
  noHoverCard?: boolean;
  /** Suppress the link wrap; render as static text only. */
  static?: boolean;
  /** Custom inline-children to render after the name (e.g. tiny pin row). */
  trailing?: ReactNode;
  className?: string;
  /** Override text size — defaults to inherit. */
  size?: 'xs' | 'sm' | 'md';
}

/**
 * Inline coach name pill: accent-gradient text, links to public profile,
 * lazy-loaded hover card with bio / team / record / role chip.
 *
 * Use this anywhere a coach username is rendered. Plain `<span>{coach.name}</span>`
 * is the wrong call now — use `<CoachLink coach={...} />` instead.
 */
export function CoachLink({
  coach,
  showAvatar = false,
  avatarSize = 'xs',
  presence,
  avatarOnly = false,
  noHoverCard = false,
  static: staticRender = false,
  trailing,
  className,
  size,
}: CoachLinkProps) {
  const display = coach.displayName?.trim() || coach.username;
  const primary = coach.primaryColor ?? FALLBACK_PRIMARY;
  const secondary = coach.secondaryColor ?? FALLBACK_SECONDARY;

  const sizeClass =
    size === 'xs' ? 'text-[11px]' :
    size === 'sm' ? 'text-xs' :
    size === 'md' ? 'text-sm' :
    '';

  // Staff (dev/admin) get the accent gradient; regular users get a solid
  // readable color from their primary (team-derived) palette so the role
  // is legible at a glance — gradient names = staff, solid = coach/user.
  // The solid color is lifted to a lightness floor so very dark team
  // colors (#530000 etc.) still read on the near-black site background.
  const isStaff = coach.role === 'dev' || coach.role === 'admin';
  const nameStyle: CSSProperties = isStaff
    ? {
        backgroundImage: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }
    : {
        color: readableOnDark(primary),
      };

  const nameNode = (
    <span
      className={cn(
        'font-medium hover:underline decoration-current decoration-1 underline-offset-2 transition-all',
        sizeClass,
      )}
      style={nameStyle}
    >
      {avatarOnly ? null : display}
    </span>
  );

  const inner = (
    <span className={cn('inline-flex items-center gap-1.5 align-middle whitespace-nowrap', className)}>
      {showAvatar && (
        <CoachAvatar
          username={coach.username}
          displayName={coach.displayName}
          avatarPath={coach.avatarPath}
          primaryColor={primary}
          secondaryColor={secondary}
          size={avatarSize}
          presence={presence}
        />
      )}
      {nameNode}
      {coach.role === 'dev' && (
        <span
          aria-label="dev"
          className="inline-flex items-center justify-center rounded-full px-1.5 py-px text-[8px] font-mono font-bold uppercase tracking-wider bg-neon/15 text-neon ring-1 ring-neon/30"
          title="Dev"
        >
          <Code2 size={8} />
        </span>
      )}
      {coach.role === 'admin' && (
        <span
          aria-label="Elder"
          className="inline-flex items-center justify-center rounded-full px-1.5 py-px text-[8px] font-mono font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
          title="Elder"
        >
          <Shield size={8} />
        </span>
      )}
      {trailing}
    </span>
  );

  if (staticRender) {
    return inner;
  }

  const linkPath = `/coach/${encodeURIComponent(coach.username)}`;

  if (noHoverCard) {
    return <Link to={linkPath} className="inline-flex">{inner}</Link>;
  }

  return (
    <CoachLinkPopover coach={coach} linkPath={linkPath}>
      {inner}
    </CoachLinkPopover>
  );
}

// ─── Hover card ───────────────────────────────────────────────────────────

interface CoachLinkPopoverProps {
  coach: CoachRef;
  linkPath: string;
  children: ReactNode;
}

function CoachLinkPopover({ coach, linkPath, children }: CoachLinkPopoverProps) {
  const [profile, setProfile] = useState<ApiPublicProfile | null>(null);
  // Pin strip in the popover — small `xs` icons surfacing the trophy case at
  // a glance. Fetched alongside the profile so a single hover hits both
  // endpoints. Empty array = nothing to show (graceful no-op).
  const [pins, setPins] = useState<ApiPin[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const fetchProfile = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    try {
      const [data, userPins] = await Promise.all([
        api.getPublicProfile(coach.username),
        api.getUserPins(coach.username).catch(() => [] as ApiPin[]),
      ]);
      setProfile(data);
      setPins(userPins);
    } catch {
      // Allow retry on next hover by clearing the flag.
      fetchedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [coach.username]);

  // Merge: local props are authoritative for color/role; fetched profile fills bio/teams/career.
  const merged = {
    username: coach.username,
    displayName: coach.displayName ?? profile?.displayName ?? null,
    avatarPath: coach.avatarPath ?? profile?.avatarPath ?? null,
    primaryColor: coach.primaryColor ?? profile?.primaryColor ?? null,
    secondaryColor: coach.secondaryColor ?? profile?.secondaryColor ?? null,
    tertiaryColor: coach.tertiaryColor ?? profile?.tertiaryColor ?? null,
    bio: profile?.bio ?? null,
    currentTeams: profile?.currentTeams ?? [],
    careerSummary: profile?.careerSummary ?? null,
    createdAt: profile?.createdAt ?? null,
  };

  const display = merged.displayName?.trim() || merged.username;
  const primary = merged.primaryColor ?? FALLBACK_PRIMARY;
  const secondary = merged.secondaryColor ?? FALLBACK_SECONDARY;
  const tertiary = merged.tertiaryColor ?? blendHex(primary, secondary);

  const isStaff = coach.role === 'dev' || coach.role === 'admin';
  const nameStyle: CSSProperties = isStaff
    ? {
        backgroundImage: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }
    : {
        color: readableOnDark(primary),
      };

  const bannerStyle: CSSProperties = {
    background: `linear-gradient(135deg, ${primary}40 0%, ${secondary}30 50%, ${tertiary}25 100%)`,
  };

  return (
    <Popover>
      <PopoverTrigger
        nativeButton={false}
        openOnHover
        delay={250}
        closeDelay={150}
        render={
          <Link
            to={linkPath}
            onMouseEnter={() => void fetchProfile()}
            onFocus={() => void fetchProfile()}
            className="inline-flex"
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-72 p-0 overflow-hidden border-border-default"
      >
        {/* Banner */}
        <div className="relative h-14 w-full" style={bannerStyle}>
          <div className="absolute -bottom-6 left-3">
            <CoachAvatar
              username={merged.username}
              displayName={merged.displayName}
              avatarPath={merged.avatarPath}
              primaryColor={primary}
              secondaryColor={secondary}
              size={48}
            />
          </div>
        </div>

        {/* Identity */}
        <div className="pt-7 px-3 pb-2.5">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <Link
              to={linkPath}
              className="text-base font-bold leading-tight truncate hover:underline"
              style={nameStyle}
            >
              {display}
            </Link>
            {coach.role === 'dev' && (
              <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-neon/15 text-neon px-1.5 py-px rounded-full ring-1 ring-neon/30 shrink-0">
                Dev
              </span>
            )}
            {coach.role === 'admin' && (
              <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 px-1.5 py-px rounded-full ring-1 ring-amber-400/30 shrink-0">
                Elder
              </span>
            )}
          </div>
          {merged.displayName && merged.displayName !== merged.username && (
            <div className="text-[10px] text-text-muted mt-0.5 font-mono">@{merged.username}</div>
          )}
          {merged.bio && (
            <p className="text-xs text-text-secondary mt-1.5 leading-snug line-clamp-2">
              {merged.bio}
            </p>
          )}
        </div>

        {/* Current teams */}
        {merged.currentTeams.length > 0 && (
          <div className="border-t border-border-subtle/50 px-3 py-2 space-y-1">
            {merged.currentTeams.map(t => (
              <Link
                key={t.teamId}
                to={`/league/${t.leagueId}/teams/${t.teamId}`}
                className="flex items-center gap-2 text-xs hover:bg-surface-overlay/40 rounded px-1 -mx-1 py-0.5 transition-colors"
              >
                <TeamLogo abbrev={t.teamAbbrev} color={t.teamColor} size="sm" />
                <span className="text-text-primary font-medium truncate">{t.teamName}</span>
                <span className="text-[10px] font-mono text-text-muted">{t.teamAbbrev}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Career stats */}
        {merged.careerSummary && (
          <div className="border-t border-border-subtle/50 px-3 py-2 grid grid-cols-3 gap-2 text-center">
            <CareerStat
              label="Career"
              value={formatRecord(merged.careerSummary.careerWins, merged.careerSummary.careerLosses)}
            />
            <CareerStat
              label="K/D"
              value={`${merged.careerSummary.careerKills}/${merged.careerSummary.careerDeaths}`}
            />
            <CareerStat
              label="Titles"
              value={merged.careerSummary.championships > 0
                ? String(merged.careerSummary.championships)
                : '—'}
              accent={merged.careerSummary.championships > 0 ? '#fbbf24' : undefined}
            />
          </div>
        )}

        {/* Pin strip — top 6 awarded pins as 24px circular badges. Tooltip
            on each surfaces the def description + earned-at relative time
            (Pin component owns that). Caps at 6 to keep the popover compact;
            the full trophy case lives on the profile page. */}
        {pins.length > 0 && (
          <div className="border-t border-border-subtle/50 px-3 py-2 flex items-center gap-1.5 flex-wrap">
            {pins.slice(0, 6).map(p => (
              <Pin
                key={p.id}
                def={p.definition}
                size="sm"
                seasonId={p.seasonId}
                metadata={p.metadata}
              />
            ))}
            {pins.length > 6 && (
              <span className="text-[9px] font-mono text-text-muted ml-0.5 tabular-nums">
                +{pins.length - 6}
              </span>
            )}
          </div>
        )}

        {/* Footer link */}
        <Link
          to={linkPath}
          className="block border-t border-border-subtle/50 px-3 py-1.5 text-[11px] text-text-muted hover:text-neon transition-colors flex items-center justify-between"
        >
          <span className="flex items-center gap-1">
            View profile
            <ChevronRight size={11} />
          </span>
          {merged.createdAt && (
            <span className="font-mono text-[9px]">
              {formatTenure(seasonFromCreatedAt(merged.createdAt))}
            </span>
          )}
        </Link>

        {/* Loading state — subtle bar at bottom */}
        {loading && !profile && (
          <div className="h-0.5 bg-neon/40 animate-pulse" />
        )}
      </PopoverContent>
    </Popover>
  );
}

function CareerStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">{label}</span>
      <span
        className="text-xs font-bold tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Crude conversion: derive a season number from createdAt.
 * Real season tenure data should come from the backend later — for now we
 * approximate using account creation date relative to a known epoch.
 *
 * Cannoli S1 began roughly mid-2023; treating each season as ~3 months.
 */
function seasonFromCreatedAt(createdAt: string): number | null {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  const epoch = new Date('2023-06-01').getTime();
  const elapsedMs = d.getTime() - epoch;
  if (elapsedMs < 0) return 1;
  const seasons = Math.floor(elapsedMs / (90 * 24 * 60 * 60 * 1000));
  return Math.max(1, seasons + 1);
}
