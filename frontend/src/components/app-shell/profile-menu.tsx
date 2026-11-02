import { useNavigate } from 'react-router-dom';
import {
  User, UserCircle, Settings, ScrollText, Newspaper, Shield, Archive,
  MessageSquarePlus, LogOut, LogIn, type LucideIcon,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { UserAccentScope } from '../user-accent-scope';
import { CoachAvatar } from '../coach-avatar';
import { openFeedback } from '@/lib/feedback-bus';
import { usePatchNotes } from '@/lib/use-patch-notes';
import type { useAuth } from '@/lib/auth-context';
import { Badge } from './nav-links';

export type AuthUser = NonNullable<ReturnType<typeof useAuth>['user']>;
export interface MyTeam { leagueId: string; teamId: string; teamAbbrev: string; teamName: string }

export interface ProfileLink { to: string; label: string; icon: LucideIcon; badge?: number }

/** The old sidebar footer's contents, as data — shared by the avatar menu and the mobile drawer. */
export function useProfileLinks(
  user: AuthUser | null, isAdmin: boolean, myTeams: MyTeam[], activeLeagueId: string | null,
): ProfileLink[] {
  const { unread } = usePatchNotes();
  if (!user) return [];
  const team = myTeams.find(t => t.leagueId === activeLeagueId) ?? myTeams[0];
  return [
    ...(team ? [{ to: `/league/${team.leagueId}/teams/${team.teamId}`, label: 'My team', icon: User }] : []),
    { to: `/coach/${user.username}`, label: 'Profile', icon: UserCircle },
    { to: '/settings', label: 'Settings', icon: Settings },
    { to: '/rules', label: 'Rules', icon: ScrollText },
    { to: '/patch-notes', label: 'Patch notes', icon: Newspaper, badge: unread },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: Shield }] : []),
    { to: '/archive', label: 'Archive', icon: Archive },
  ];
}

export function ProfileMenu({ user, links, onLogout }: {
  user: AuthUser; links: ProfileLink[]; onLogout: () => void;
}) {
  const navigate = useNavigate();
  const unread = links.find(l => l.to === '/patch-notes')?.badge ?? 0;
  return (
    <UserAccentScope user={user}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account menu"
          title={user.username}
          className="relative rounded-full outline-none transition-all hover:ring-2 hover:ring-gem/40 focus-visible:ring-2 focus-visible:ring-gem/60"
        >
          <CoachAvatar
            username={user.username}
            displayName={user.displayName ?? null}
            avatarPath={user.avatarPath ?? null}
            primaryColor={user.primaryColor ?? null}
            secondaryColor={user.secondaryColor ?? null}
            size="md"
          />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-purple-400 ring-2 ring-surface" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {links.map(l => (
            <DropdownMenuItem key={l.to} onClick={() => navigate(l.to)}>
              <l.icon size={14} /> {l.label}
              {!!l.badge && <span className="ml-auto"><Badge n={l.badge} title="Unread patch notes" /></span>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => openFeedback()}>
            <MessageSquarePlus size={14} /> Feedback
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { onLogout(); navigate('/login'); }}>
            <LogOut size={14} /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </UserAccentScope>
  );
}

export function LoginButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/login')}
      className={className ?? 'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13.5px] font-medium text-gem-ink transition-colors hover:bg-gem/10 outline-none focus-visible:ring-2 focus-visible:ring-gem/60'}
    >
      <LogIn size={14} /> Log in
    </button>
  );
}
