import { NavLink, useNavigate } from 'react-router-dom';
import { Settings, LogOut, User, LogIn, Search, UserCircle, Shield } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { FeedbackDialog } from '../feedback-dialog';
import { NotificationsButton } from './notifications-button';
import { UserAccentScope } from '../user-accent-scope';
import { CoachAvatar } from '../coach-avatar';
import { cn } from '@/lib/utils';
import type { useAuth } from '@/lib/auth-context';

type AuthUser = NonNullable<ReturnType<typeof useAuth>['user']>;

interface MyTeam {
  leagueId: string;
  teamId: string;
  teamAbbrev: string;
  teamName: string;
}

interface SidebarFooterProps {
  user: AuthUser | null;
  /** When true, renders the Admin shortcut in the footer (admins only). */
  isAdmin?: boolean;
  myTeams: MyTeam[];
  leagues: { id: string; name: string; color: string }[];
  pendingTradeCount: number;
  onOpenCommand: () => void;
  onLogout: () => void;
  /** Icon-only rail mode. */
  collapsed?: boolean;
}

const purpleDot =
  'absolute -top-1 -right-1 w-2 h-2 rounded-full bg-purple-400 ring-2 ring-surface-raised';

export function SidebarFooter({
  user, isAdmin, myTeams, leagues, pendingTradeCount, onOpenCommand, onLogout, collapsed,
}: SidebarFooterProps) {
  const navigate = useNavigate();

  if (collapsed) {
    const firstTeam = myTeams[0];
    return (
      <div className="p-2 border-t border-border-default flex flex-col items-center gap-2">
        {user && firstTeam && (
          <NavLink
            to={`/league/${firstTeam.leagueId}/teams/${firstTeam.teamId}`}
            title={myTeams.length > 1 ? 'My Teams' : firstTeam.teamAbbrev}
            className={({ isActive }) => cn(
              'relative flex items-center justify-center h-9 w-9 rounded-md transition-colors',
              isActive ? 'bg-neon/10 text-neon' : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
            )}
          >
            <User size={16} />
            {pendingTradeCount > 0 && <span className={purpleDot} title="Pending trade proposals" />}
          </NavLink>
        )}

        {user && isAdmin && (
          <NavLink
            to="/admin"
            title="Admin"
            className={({ isActive }) => cn(
              'flex items-center justify-center h-9 w-9 rounded-md transition-colors',
              isActive ? 'bg-neon/10 text-neon' : 'text-text-muted hover:bg-surface-overlay hover:text-text-secondary',
            )}
          >
            <Shield size={16} />
          </NavLink>
        )}

        <button
          onClick={onOpenCommand}
          title="Search (Ctrl+K)"
          className="flex items-center justify-center h-9 w-9 rounded-md text-text-muted hover:bg-surface-overlay hover:text-text-secondary transition-colors"
        >
          <Search size={16} />
        </button>

        <NotificationsButton collapsed />

        {user ? (
          <UserAccentScope user={user}>
            <DropdownMenu>
              <DropdownMenuTrigger
                title={user.username}
                className="rounded-full outline-none hover:ring-2 hover:ring-neon/40 transition-all cursor-pointer"
              >
                <CoachAvatar
                  username={user.username}
                  displayName={user.displayName ?? null}
                  avatarPath={user.avatarPath ?? null}
                  primaryColor={user.primaryColor ?? null}
                  secondaryColor={user.secondaryColor ?? null}
                  size="md"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" sideOffset={8}>
                <DropdownMenuItem onClick={() => navigate(`/coach/${user.username}`)}>
                  <UserCircle size={14} />
                  View profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <Settings size={14} />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { onLogout(); navigate('/login'); }}>
                  <LogOut size={14} />
                  Log Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </UserAccentScope>
        ) : (
          <button
            onClick={() => navigate('/login')}
            title="Log In"
            className="flex items-center justify-center h-9 w-9 rounded-md text-neon hover:bg-neon/10 transition-colors"
          >
            <LogIn size={16} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 border-t border-border-default space-y-2">
      {user && myTeams.length > 0 && (
        <MyTeamSidebar myTeams={myTeams} leagues={leagues} pendingTradeCount={pendingTradeCount} />
      )}

      {/* Admin shortcut — lives in the footer instead of the main nav so
       *  staff tools sit alongside the user/account controls. */}
      {user && isAdmin && (
        <NavLink
          to="/admin"
          className={({ isActive }) => cn(
            'w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors',
            isActive
              ? 'bg-neon/10 text-neon'
              : 'text-text-muted hover:bg-surface-overlay hover:text-text-secondary',
          )}
        >
          <Shield size={14} />
          <span>Admin</span>
        </NavLink>
      )}

      <button
        onClick={onOpenCommand}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-muted hover:bg-surface-overlay hover:text-text-secondary transition-colors"
      >
        <Search size={14} />
        <span>Search</span>
        <kbd className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-text-muted">
          Ctrl+K
        </kbd>
      </button>

      <NotificationsButton />

      {user && <FeedbackDialog />}

      {user ? (
        <UserAccentScope user={user}>
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full flex items-center gap-2 rounded-md px-1 py-1 -mx-1 hover:bg-surface-overlay transition-colors cursor-pointer outline-none">
              <CoachAvatar
                username={user.username}
                displayName={user.displayName ?? null}
                avatarPath={user.avatarPath ?? null}
                primaryColor={user.primaryColor ?? null}
                secondaryColor={user.secondaryColor ?? null}
                size="md"
              />
              <div className="text-xs text-left min-w-0">
                <div className="text-text-primary font-medium truncate">{user.username}</div>
                <div className="text-text-muted">{user.role}</div>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8}>
              <DropdownMenuItem onClick={() => navigate(`/coach/${user.username}`)}>
                <UserCircle size={14} />
                View profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings size={14} />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { onLogout(); navigate('/login'); }}>
                <LogOut size={14} />
                Log Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </UserAccentScope>
      ) : (
        <button
          onClick={() => navigate('/login')}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-neon hover:bg-neon/10 transition-colors"
        >
          <LogIn size={14} />
          Log In
        </button>
      )}
    </div>
  );
}

interface MyTeamSidebarProps {
  myTeams: MyTeam[];
  leagues: { id: string; name: string; color: string }[];
  pendingTradeCount: number;
}

function MyTeamSidebar({ myTeams, leagues, pendingTradeCount }: MyTeamSidebarProps) {
  // Single team: render direct link. Multiple: render a stacked group.
  if (myTeams.length === 1) {
    const t = myTeams[0]!;
    const league = leagues.find(l => l.id === t.leagueId);
    return (
      <NavLink
        to={`/league/${t.leagueId}/teams/${t.teamId}`}
        className={({ isActive }) => cn(
          'w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors',
          isActive
            ? 'bg-neon/10 text-neon'
            : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
        )}
      >
        <User size={14} />
        <span className="truncate">{t.teamAbbrev}</span>
        <span className="text-[9px] truncate text-text-muted ml-auto" style={league ? { color: league.color } : undefined}>
          {league?.name.replace(' League', '')}
        </span>
        {pendingTradeCount > 0 && (
          <span title="Pending trade proposals" className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-purple-400/20 text-purple-400 text-[9px] font-bold tabular-nums">
            {pendingTradeCount}
          </span>
        )}
      </NavLink>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 px-3 py-1 text-[10px] uppercase tracking-wider text-text-muted">
        <User size={11} />
        <span>My Teams</span>
        {pendingTradeCount > 0 && (
          <span title="Pending trade proposals" className="ml-auto inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-purple-400/20 text-purple-400 text-[9px] font-bold tabular-nums">
            {pendingTradeCount}
          </span>
        )}
      </div>
      {myTeams.map(t => {
        const league = leagues.find(l => l.id === t.leagueId);
        return (
          <NavLink
            key={t.leagueId}
            to={`/league/${t.leagueId}/teams/${t.teamId}`}
            className={({ isActive }) => cn(
              'w-full flex items-center gap-2 px-3 py-1 rounded-md text-xs transition-colors',
              isActive
                ? 'bg-neon/10 text-neon'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
            )}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: league?.color }}
            />
            <span className="truncate">{t.teamAbbrev}</span>
            <span className="text-[9px] text-text-muted ml-auto">{league?.name.replace(' League', '')}</span>
          </NavLink>
        );
      })}
    </div>
  );
}
