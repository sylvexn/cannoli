import { Link } from 'react-router-dom';
import { Search, Menu } from 'lucide-react';
import { NeonLogo } from '../neon-logo';
import { NotificationsButton } from './notifications-button';
import { LeagueSwitcher } from './league-switcher';
import { LiveIndicator, type LiveMatch } from './live-indicator';
import { NavItemLink, TOOL_NAV, type NavItem } from './nav-links';
import { ProfileMenu, LoginButton, type AuthUser, type ProfileLink } from './profile-menu';
import type { useAppData } from '@/lib/app-data-context';

type League = ReturnType<typeof useAppData>['leagues'][number];

interface TopBarProps {
  leagues: League[];
  activeLeague: League | null;
  leagueItems: NavItem[];
  liveMatches: LiveMatch[];
  user: AuthUser | null;
  profileLinks: ProfileLink[];
  onLogout: () => void;
  onOpenSearch: () => void;
  onOpenDrawer: () => void;
}

const iconBtn =
  'flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-overlay/60 hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-gem/60';

export function TopBar(p: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-border-subtle bg-surface/80 backdrop-blur shadow-[inset_0_2px_0_var(--gem)]">
      <div className="flex h-12 items-center gap-3 px-4">
        <Link to="/" aria-label="Cannoli home" className="shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-gem/60 rounded">
          <NeonLogo className="h-6 w-auto" />
        </Link>
        <LeagueSwitcher leagues={p.leagues} active={p.activeLeague} />

        <nav aria-label="Primary" className="hidden min-w-0 items-center gap-0.5 lg:flex">
          {p.leagueItems.map(i => <NavItemLink key={i.to} item={i} variant="bar" />)}
          {p.leagueItems.length > 0 && <span aria-hidden className="mx-2 h-5 w-px bg-border-default" />}
          {TOOL_NAV.map(i => <NavItemLink key={i.to} item={i} variant="bar" />)}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button onClick={p.onOpenSearch} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)" className={iconBtn}>
            <Search size={16} />
          </button>
          <LiveIndicator matches={p.liveMatches} leagues={p.leagues} />
          <NotificationsButton collapsed />
          <div className="hidden lg:block">
            {p.user
              ? <ProfileMenu user={p.user} links={p.profileLinks} onLogout={p.onLogout} />
              : <LoginButton />}
          </div>
          <button onClick={p.onOpenDrawer} aria-label="Open navigation" className={`${iconBtn} lg:hidden`}>
            <Menu size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
