import { NavLink, useNavigate } from 'react-router-dom';
import { X, MessageSquarePlus, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openFeedback } from '@/lib/feedback-bus';
import { NavItemLink, TOOL_NAV, Badge, type NavItem } from './nav-links';
import { LoginButton, type AuthUser, type ProfileLink } from './profile-menu';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  leagueItems: NavItem[];
  user: AuthUser | null;
  profileLinks: ProfileLink[];
  onLogout: () => void;
}

const row = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-overlay/60 hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-gem/60';

/** Always-mounted off-canvas drawer (CSS transform, not a Sheet) shown below lg. */
export function MobileDrawer({ open, onClose, leagueItems, user, profileLinks, onLogout }: MobileDrawerProps) {
  const navigate = useNavigate();
  return (
    <div className="lg:hidden">
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        inert={!open}
        aria-label="Navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-full max-w-72 flex-col overflow-y-auto border-r border-border-default bg-surface-raised p-3 transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        <div className="mb-2 flex justify-end">
          <button onClick={onClose} aria-label="Close navigation" className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Primary" className="space-y-0.5">
          {leagueItems.map(i => <NavItemLink key={i.to} item={i} variant="drawer" onNavigate={onClose} />)}
          {leagueItems.length > 0 && <div className="mx-2 my-2 h-px bg-border-subtle" />}
          {TOOL_NAV.map(i => <NavItemLink key={i.to} item={i} variant="drawer" onNavigate={onClose} />)}
        </nav>
        <div className="mx-2 my-2 h-px bg-border-subtle" />
        {user ? (
          <div className="space-y-0.5">
            {profileLinks.map(l => (
              <NavLink key={l.to} to={l.to} onClick={onClose} className={row}>
                <l.icon size={16} className="shrink-0" /> {l.label}
                {!!l.badge && <span className="ml-auto"><Badge n={l.badge} title="Unread patch notes" /></span>}
              </NavLink>
            ))}
            <button className={row} onClick={() => { onClose(); openFeedback(); }}>
              <MessageSquarePlus size={16} className="shrink-0" /> Feedback
            </button>
            <button className={row} onClick={() => { onClose(); onLogout(); navigate('/login'); }}>
              <LogOut size={16} className="shrink-0" /> Log out
            </button>
          </div>
        ) : (
          <LoginButton className={row} />
        )}
      </aside>
    </div>
  );
}
