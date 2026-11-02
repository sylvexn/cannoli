import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/badge';
import { NeonLogo } from '@/components/neon-logo';
import { ProfileMenu, LoginButton, useProfileLinks, type MyTeam } from '@/components/app-shell/profile-menu';

const iconBtn =
  'flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-overlay/60 hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-gem/60';

/** The site avatar menu's links, minus Admin (you are already here). */
function useSiteProfileLinks() {
  const { user, logout } = useAuth();
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.getMyTeams().then(r => { if (!cancelled) setMyTeams(r.teams); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user]);
  let activeLeagueId: string | null = null;
  try { activeLeagueId = JSON.parse(localStorage.getItem('cannoli:activeLeagueId') ?? 'null'); } catch { /* ignore */ }
  return { user, logout, links: useProfileLinks(user, false, myTeams, activeLeagueId) };
}

export function AdminHeader({ mode, onOpenSearch }: { mode: 'live' | 'mock' | null; onOpenSearch: () => void }) {
  const { user, logout, links } = useSiteProfileLinks();
  return (
    <header className="shrink-0 border-b border-border-subtle bg-surface/85 backdrop-blur shadow-[inset_0_2px_0_var(--color-loss)]">
      <div className="flex h-[46px] items-center gap-3 px-4">
        <Link to="/" aria-label="Cannoli home" className="shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-gem/60">
          <NeonLogo className="h-6 w-auto" color="#ff3b5c" />
        </Link>
        <span className="font-display text-xl font-semibold tracking-wide text-text-primary">Admin</span>
        {mode && (
          <Badge
            variant="outline"
            className={cn(
              'text-[9px] font-mono uppercase tracking-wider px-1.5 py-0 h-4',
              mode === 'live' ? 'border-win/40 text-win bg-win/10' : 'border-draw/40 text-draw bg-draw/10',
            )}
            title={mode === 'live' ? 'Pointing at live DB' : 'Pointing at mock DB (mock.cannoli.live)'}
          >
            {mode}
          </Badge>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button onClick={onOpenSearch} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)" className={iconBtn}>
            <Search size={16} />
          </button>
          <Link
            to="/"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default px-2.5 text-[13px] text-text-secondary transition-colors hover:bg-surface-overlay/60 hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-gem/60"
          >
            <ArrowLeft size={14} /> <span className="hidden sm:inline">Back to site</span>
          </Link>
          {user ? <ProfileMenu user={user} links={links} onLogout={logout} /> : <LoginButton />}
        </div>
      </div>
    </header>
  );
}
