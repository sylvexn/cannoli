import type { Player } from '@/lib/types';
import { CoachLink } from '@/components/coach-link';

interface TeamCoachProps {
  player: Pick<Player, 'name' | 'owner'>;
  /** Show the avatar inline before the name. */
  showAvatar?: boolean;
  /** Avatar size — accepts CoachAvatar's named scale or raw px. */
  avatarSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | number;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  /** Disable the hover card (still renders the link if owner exists). */
  noHoverCard?: boolean;
  /** Optional presence indicator forwarded to the avatar. */
  presence?: 'online' | 'away' | 'in-draft';
}

/**
 * Renders a team's coach as a `<CoachLink>` when owner data is available
 * (joined from the users table on the backend), falling back to a plain
 * span of `player.name` otherwise. Use this anywhere a Player is in scope
 * and you want the coach name to be linkable / hover-card enabled.
 */
export function TeamCoach({
  player,
  showAvatar = false,
  avatarSize = 'xs',
  size,
  className,
  noHoverCard = false,
  presence,
}: TeamCoachProps) {
  if (player.owner) {
    return (
      <CoachLink
        coach={{
          username: player.owner.username,
          displayName: player.owner.displayName,
          primaryColor: player.owner.primaryColor,
          secondaryColor: player.owner.secondaryColor,
          tertiaryColor: player.owner.tertiaryColor,
          avatarPath: player.owner.avatarPath,
          role: player.owner.role,
        }}
        showAvatar={showAvatar}
        avatarSize={avatarSize}
        size={size}
        noHoverCard={noHoverCard}
        presence={presence}
        className={className}
      />
    );
  }

  // No owner attached — render plain text. Fallback for legacy seed data
  // or teams that haven't been claimed by a user yet.
  return <span className={className}>{player.name}</span>;
}
