import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TeamLogo } from '@/components/team-logo';
import { CoachLink } from '@/components/coach-link';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { RecordDisplay } from '@/components/record-display';
import { api, type ApiTeam } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';

/** Minimal data needed to render the trigger. The full ApiTeam is fetched
 *  lazily on hover so the caller doesn't have to plumb roster everywhere. */
export interface TeamRef {
  leagueId: string;
  teamId: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  logoPath?: string | null;
  /** Optional pre-loaded record — skips the fetch if present. */
  record?: { wins: number; losses: number; differential: number };
}

interface TeamLinkProps {
  team: TeamRef;
  /** Show the logo before the abbreviation. Default true. */
  showLogo?: boolean;
  /** Logo size. Default 'sm'. */
  logoSize?: 'sm' | 'md' | 'lg' | 'xl';
  /** Render only the logo (no abbreviation). */
  logoOnly?: boolean;
  /** Disable the hover card entirely (still renders the link). */
  noHoverCard?: boolean;
  /** Suppress the link wrap; render as static span. */
  static?: boolean;
  /** Custom child instead of the default abbrev label. */
  children?: ReactNode;
  className?: string;
  /** Replace the default `inline-flex items-center gap-1.5 align-middle` inner classes
   *  AND the link's `inline-flex` — useful when wrapping card-shaped triggers. */
  asCard?: boolean;
  /** Text size override for the abbrev label. */
  size?: 'xs' | 'sm' | 'md';
}

/**
 * Inline team chip: logo + abbrev → links to the team profile, opens a hover
 * card with logo, record, and roster sprites. Mirrors `<CoachLink>` so callers
 * don't have to hand-roll their own popover for every team mention.
 */
export function TeamLink({
  team,
  showLogo = true,
  logoSize = 'sm',
  logoOnly = false,
  noHoverCard = false,
  static: staticRender = false,
  children,
  className,
  asCard = false,
  size,
}: TeamLinkProps) {
  const sizeClass =
    size === 'xs' ? 'text-[11px]' :
    size === 'sm' ? 'text-xs' :
    size === 'md' ? 'text-sm' :
    '';

  const label = children ?? (
    <span
      className={cn(
        'font-medium hover:underline decoration-current decoration-1 underline-offset-2',
        sizeClass,
      )}
      style={{ color: team.teamColor }}
    >
      {team.teamAbbrev}
    </span>
  );

  const inner = asCard ? (
    <>{children}</>
  ) : (
    <span className={cn('inline-flex items-center gap-1.5 align-middle', className)}>
      {showLogo && (
        <TeamLogo
          abbrev={team.teamAbbrev}
          color={team.teamColor}
          logoPath={team.logoPath ?? null}
          size={logoSize}
        />
      )}
      {!logoOnly && label}
    </span>
  );

  if (staticRender) return inner;

  const linkPath = `/league/${team.leagueId}/teams/${team.teamId}`;

  if (noHoverCard) {
    return <Link to={linkPath} className={cn(asCard ? className : 'inline-flex')}>{inner}</Link>;
  }

  return (
    <TeamLinkPopover team={team} linkPath={linkPath} asCard={asCard} cardClassName={className}>
      {inner}
    </TeamLinkPopover>
  );
}

// ─── Hover card ───────────────────────────────────────────────────────────

interface TeamLinkPopoverProps {
  team: TeamRef;
  linkPath: string;
  children: ReactNode;
  asCard?: boolean;
  cardClassName?: string;
}

function TeamLinkPopover({ team, linkPath, children, asCard, cardClassName }: TeamLinkPopoverProps) {
  const [fullTeam, setFullTeam] = useState<ApiTeam | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const fetchTeam = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    try {
      const teams = await api.getTeams(team.leagueId);
      const match = teams.find(t => t.id === team.teamId);
      if (match) setFullTeam(match);
    } catch {
      fetchedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [team.leagueId, team.teamId]);

  // Banner uses the team color faceted gradient
  const bannerStyle = useMemo(() => ({
    background:
      `linear-gradient(135deg, ${team.teamColor}55 0%, ${team.teamColor}25 60%, ${team.teamColor}10 100%),` +
      `radial-gradient(ellipse 60% 70% at 30% 30%, ${team.teamColor}40 0%, transparent 60%)`,
  }), [team.teamColor]);

  const record = fullTeam?.record ?? team.record;
  const roster = fullTeam?.roster ?? [];
  const owner = fullTeam?.owner;

  return (
    <Popover>
      <PopoverTrigger
        nativeButton={false}
        openOnHover
        delay={200}
        closeDelay={120}
        render={
          <Link
            to={linkPath}
            onMouseEnter={() => void fetchTeam()}
            onFocus={() => void fetchTeam()}
            className={asCard ? cardClassName : 'inline-flex'}
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
        {/* Banner with logo */}
        <div className="relative h-14 w-full" style={bannerStyle}>
          <div className="absolute -bottom-5 left-3">
            <TeamLogo
              abbrev={team.teamAbbrev}
              color={team.teamColor}
              logoPath={team.logoPath ?? fullTeam?.logoPath ?? null}
              size="lg"
            />
          </div>
        </div>

        {/* Identity */}
        <div className="pt-7 px-3 pb-2.5">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <Link
              to={linkPath}
              className="text-base font-bold leading-tight truncate hover:underline"
              style={{ color: team.teamColor }}
            >
              {fullTeam?.teamName ?? team.teamName}
            </Link>
            <span className="text-[10px] font-mono text-text-muted shrink-0">{team.teamAbbrev}</span>
          </div>
          {owner && (
            <div className="mt-1">
              <CoachLink
                coach={{
                  username: owner.username,
                  displayName: owner.displayName,
                  avatarPath: owner.avatarPath,
                  primaryColor: owner.primaryColor,
                  secondaryColor: owner.secondaryColor,
                  tertiaryColor: owner.tertiaryColor,
                  role: owner.role,
                }}
                showAvatar
                avatarSize="sm"
                size="xs"
                noHoverCard
              />
            </div>
          )}
          {record && (
            <div className="mt-1.5">
              <RecordDisplay
                wins={record.wins}
                losses={record.losses}
                differential={record.differential}
                className="text-xs"
              />
            </div>
          )}
        </div>

        {/* Roster sprites */}
        {roster.length > 0 && (
          <div
            className="border-t border-border-subtle/50 px-3 py-2 flex items-center gap-0.5 flex-wrap"
            style={{
              background: `linear-gradient(180deg, ${team.teamColor}08 0%, transparent 100%)`,
            }}
          >
            {roster.slice(0, 12).map(mon => (
              <div key={mon.name} className="relative shrink-0" title={mon.name}>
                <PokemonSprite name={mon.name} size="sm" shiny={mon.isShiny} />
                {mon.isTeraCaptain && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-surface-base"
                    style={{ backgroundColor: '#e879f9' }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer link */}
        <Link
          to={linkPath}
          className="block border-t border-border-subtle/50 px-3 py-1.5 text-[11px] text-text-muted hover:text-neon transition-colors flex items-center justify-between"
        >
          <span className="flex items-center gap-1">
            View team
            <ChevronRight size={11} />
          </span>
        </Link>

        {loading && !fullTeam && (
          <div className="h-0.5 bg-neon/40 animate-pulse" />
        )}
      </PopoverContent>
    </Popover>
  );
}
