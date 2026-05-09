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

interface TeamCoachStackProps {
  team: TeamInfo;
  /** Logo size — coach avatar is ~80% of this. Default 'sm'. */
  size?: 'sm' | 'md' | 'lg';
  /** Which side the coach avatar peeks from. Default 'right'. */
  side?: 'left' | 'right';
  /** Disable links (use when rendered inside another <Link>). */
  static?: boolean;
  className?: string;
}

const LOGO_PX: Record<NonNullable<TeamCoachStackProps['size']>, number> = {
  sm: 28,
  md: 36,
  lg: 48,
};

const COACH_PX: Record<NonNullable<TeamCoachStackProps['size']>, number> = {
  sm: 22,
  md: 28,
  lg: 38,
};

/** Overlap proportion — coach circle slides under the logo by this fraction
 *  of its own width. 0.32 keeps both faces fully readable. */
const OVERLAP = 0.32;

/**
 * AvatarGroup-style: team logo + coach avatar shown as overlapping circles.
 * Use in compact dense rows (standings upcoming/recent matches, schedule
 * list cells, archive views) where you want both identities visible without
 * spending two cells of horizontal space. Falls back to a plain TeamLogo
 * when the team has no owner attached.
 */
export function TeamCoachStack({
  team,
  size = 'sm',
  side = 'right',
  static: staticRender = false,
  className,
}: TeamCoachStackProps) {
  const logoPx = LOGO_PX[size];
  const coachPx = COACH_PX[size];
  const overlap = Math.round(coachPx * OVERLAP);
  const totalWidth = logoPx + coachPx - overlap;
  const owner = team.owner ?? null;

  const logoEl = (
    <TeamLogo
      abbrev={team.teamAbbrev}
      color={team.teamColor}
      size={size}
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

  // Avatar tucks under the logo. side='right' → coach trails behind the logo
  // on the right (logo is the visually dominant front element on the left).
  // side='left' mirrors for away-side rows so the pair "leans inward" toward
  // a center divider.
  const avatarEl = (
    <CoachAvatar
      username={owner.username}
      displayName={owner.displayName}
      avatarPath={owner.avatarPath}
      primaryColor={owner.primaryColor ?? team.teamColor}
      secondaryColor={owner.secondaryColor ?? team.teamColor}
      size={coachPx}
      ringColor={team.teamColor}
    />
  );

  // Wrapper sets a fixed width so callers' flex math doesn't have to know
  // about the overlap. Children are absolutely positioned for clean z-order
  // control without depending on flex source order.
  return (
    <span
      className={cn('relative inline-block shrink-0 align-middle', className)}
      style={{ width: totalWidth, height: logoPx }}
    >
      <span
        className="absolute top-0"
        style={{
          [side === 'right' ? 'left' : 'right']: 0,
          zIndex: 2,
        }}
      >
        {staticRender ? logoEl : (
          <Link
            to={`/league/${team.leagueId}/teams/${team.teamId}`}
            viewTransition
            onClick={e => e.stopPropagation()}
            className="block"
          >
            {logoEl}
          </Link>
        )}
      </span>
      <span
        className="absolute"
        style={{
          [side === 'right' ? 'right' : 'left']: 0,
          top: Math.round((logoPx - coachPx) / 2),
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
