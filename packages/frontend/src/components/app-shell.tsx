import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Trophy, Swords, Users, BarChart3, Calendar, ArrowLeftRight,
  Shield, LayoutDashboard,
} from 'lucide-react';
import { currentSeason } from '@/mocks/season';

const navItems = [
  { to: '/', label: 'Standings', icon: Trophy },
  { to: '/draft', label: 'Draft Board', icon: LayoutDashboard },
  { to: '/schedule', label: 'Schedule', icon: Calendar },
  { to: '/stats', label: 'Pokemon Stats', icon: BarChart3 },
  { to: '/matchup', label: 'Matchup Center', icon: Swords },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/trades', label: 'Trade Block', icon: ArrowLeftRight },
  { to: '/admin', label: 'Admin', icon: Shield },
];

const phaseColors = {
  draft: 'text-draw bg-draw/10',
  regular: 'text-neon bg-neon/10',
  playoffs: 'text-pink bg-pink/10',
  offseason: 'text-text-muted bg-surface-overlay',
};

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-surface-raised border-r border-border-default flex flex-col">
        {/* Logo / League Header */}
        <div className="p-4 border-b border-border-default">
          <h1 className="text-lg font-heading font-bold text-neon tracking-tighter">cannoli</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded', phaseColors[currentSeason.phase])}>
              {currentSeason.phase}
            </span>
            <span className="text-xs text-text-muted">
              Season {currentSeason.seasonNumber} &middot; Week {currentSeason.currentWeek}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-neon/10 text-neon'
                  : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
              )}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-border-default">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-neon/20 flex items-center justify-center text-neon text-xs font-bold">
              A
            </div>
            <div className="text-xs">
              <div className="text-text-primary font-medium">Admin</div>
              <div className="text-text-muted">admin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-surface">
        <div className="max-w-7xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
