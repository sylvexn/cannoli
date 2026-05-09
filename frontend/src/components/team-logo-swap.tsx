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

interface TeamLogoSwapProps {
  team: TeamInfo;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Disable the link wrap (e.g., when used inside another <Link>). */
  static?: boolean;
}

const PX_BY_SIZE: Record<NonNullable<TeamLogoSwapProps['size']>, number> = {
  sm: 28,
  md: 36,
  lg: 48,
  xl: 96,
};

const COACH_SIZE_BY_LOGO: Record<NonNullable<TeamLogoSwapProps['size']>, number> = {
  sm: 26,
  md: 34,
  lg: 46,
  xl: 92,
};

/**
 * Logo by default, crossfades to the coach's avatar on hover. Click navigates
 * to the team page (the logo is the canonical entity here — coach detail is a
 * separate page reachable from the team profile).
 */
export function TeamLogoSwap({
  team,
  size = 'md',
  className,
  static: staticRender = false,
}: TeamLogoSwapProps) {
  const px = PX_BY_SIZE[size];
  const coachPx = COACH_SIZE_BY_LOGO[size];
  const owner = team.owner ?? null;

  const swap = (
    <span
      className={cn('relative inline-block group/swap', className)}
      style={{ width: px, height: px }}
    >
      <TeamLogo
        abbrev={team.teamAbbrev}
        color={team.teamColor}
        size={size}
        logoPath={team.logoPath ?? undefined}
        className="absolute inset-0 transition-opacity duration-200 ease-out group-hover/swap:opacity-0"
      />
      {owner && (
        <span
          className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 ease-out group-hover/swap:opacity-100"
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
      )}
    </span>
  );

  if (staticRender || !owner) return swap;

  return (
    <Link
      to={`/league/${team.leagueId}/teams/${team.teamId}`}
      viewTransition
      className="shrink-0 inline-block"
      onClick={e => e.stopPropagation()}
    >
      {swap}
    </Link>
  );
}
