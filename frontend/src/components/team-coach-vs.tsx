import { Link } from 'react-router-dom';
import { TeamLogo } from '@/components/team-logo';
import { CoachAvatar } from '@/components/coach-avatar';
import { cn } from '@/lib/utils';

interface CoachInfo {
  username: string;
  displayName?: string | null;
  avatarPath?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
}

interface TeamInfo {
  leagueId: string;
  teamId: string;
  teamAbbrev: string;
  teamColor: string;
  logoPath?: string | null;
  owner?: CoachInfo | null;
}

interface TeamCoachVsProps {
  team: TeamInfo;
  /** 'home' = left side of a VS divider, coach tucks bottom-right toward
   *  center. 'away' = right side, coach tucks bottom-left. */
  side: 'home' | 'away';
  /** Logo size. 'sm'/'md' for inline match cards, 'lg' for hero rows, 'xl'
   *  for full-screen replay theater UI. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Disable links (use when wrapped in another <Link>). */
  static?: boolean;
  className?: string;
}

const LOGO_PX: Record<NonNullable<TeamCoachVsProps['size']>, number> = {
  sm: 28,
  md: 36,
  lg: 48,
  xl: 96,
};

const COACH_PX: Record<NonNullable<TeamCoachVsProps['size']>, number> = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 44,
};

/** Map our 'sm'|'md'|'lg'|'xl' to TeamLogo's 'sm'|'md'|'lg'|'xl' (1:1). */
const TEAM_LOGO_SIZE = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
} as const;

/**
 * VS hero pair: large team logo with the coach's avatar tucked into the
 * bottom-inner corner like a picture-in-picture badge. The coach circle
 * always points toward the VS divider — `side="home"` puts it bottom-right,
 * `side="away"` mirrors to bottom-left so a centered match card "leans"
 * inward visually.
 *
 * Used in: schedule match cards (size="lg"), replay preroll/lobby/postroll
 * (size="xl"). Falls back to a plain TeamLogo when the team has no owner.
 */
export function TeamCoachVs({
  team,
  side,
  size = 'lg',
  static: staticRender = false,
  className,
}: TeamCoachVsProps) {
  const logoPx = LOGO_PX[size];
  const coachPx = COACH_PX[size];
  const owner = team.owner ?? null;

  const logoEl = (
    <TeamLogo
      abbrev={team.teamAbbrev}
      color={team.teamColor}
      size={TEAM_LOGO_SIZE[size]}
      logoPath={team.logoPath ?? undefined}
    />
  );

  if (!owner) {
    if (staticRender) return logoEl;
    return (
      <Link
        to={`/league/${team.leagueId}/teams/${team.teamId}`}
        viewTransition
        onClick={e => e.stopPropagation()}
        className={cn('shrink-0 inline-block', className)}
      >
        {logoEl}
      </Link>
    );
  }

  // PiP nudge: pull the avatar 18% of its width past the logo edge so it
  // reads as a tucked badge rather than a sibling circle.
  const inset = -Math.round(coachPx * 0.18);
  const innerCorner = side === 'home' ? { right: inset } : { left: inset };

  const avatarEl = (
    <span
      className="block rounded-full"
      style={{
        // Subtle dark cutout so the avatar reads against busy logos.
        boxShadow: '0 0 0 2px rgb(11 12 18)',
      }}
    >
      <CoachAvatar
        username={owner.username}
        displayName={owner.displayName}
        avatarPath={owner.avatarPath}
        primaryColor={owner.primaryColor ?? team.teamColor}
        secondaryColor={owner.secondaryColor ?? team.teamColor}
        size={coachPx}
        ringColor={team.teamColor}
      />
    </span>
  );

  return (
    <span
      className={cn('relative inline-block shrink-0 align-middle', className)}
      style={{ width: logoPx, height: logoPx }}
    >
      {staticRender ? (
        <span className="block">{logoEl}</span>
      ) : (
        <Link
          to={`/league/${team.leagueId}/teams/${team.teamId}`}
          viewTransition
          onClick={e => e.stopPropagation()}
          className="block"
        >
          {logoEl}
        </Link>
      )}
      <span
        className="absolute"
        style={{
          bottom: inset,
          ...innerCorner,
          zIndex: 1,
        }}
      >
        {staticRender ? avatarEl : (
          <Link
            to={`/coach/${owner.username}`}
            viewTransition
            onClick={e => e.stopPropagation()}
            className="block"
          >
            {avatarEl}
          </Link>
        )}
      </span>
    </span>
  );
}
