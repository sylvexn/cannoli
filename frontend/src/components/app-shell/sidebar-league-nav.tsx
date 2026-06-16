import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Trophy, BarChart3, Calendar, ArrowLeftRight,
  LayoutDashboard, ChevronDown,
} from 'lucide-react';
import { PHASE_COLORS, leagueGem } from '@/lib/constants';
import { usePointerTilt } from '@/lib/use-pointer-tilt';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { useAppData } from '@/lib/app-data-context';

type League = ReturnType<typeof useAppData>['leagues'][number];

export const leaguePages = [
  { path: '', label: 'Standings', icon: Trophy },
  { path: '/draft', label: 'Draft Board', icon: LayoutDashboard },
  { path: '/schedule', label: 'Schedule', icon: Calendar },
  { path: '/stats', label: 'Pokemon Stats', icon: BarChart3 },
  { path: '/market', label: 'Market', icon: ArrowLeftRight },
];

const phaseLabel = (league: League) =>
  league.season.phase === 'regular'
    ? `W${league.season.currentWeek}`
    : league.season.phase.slice(0, 3);

interface SidebarLeagueNavProps {
  leagues: League[];
  openLeagueId: string | null;
  onToggle: (id: string) => void;
  pendingByLeague: Record<string, number>;
  /** Icon-only rail mode — leagues collapse to gem squares with a flyout. */
  collapsed?: boolean;
}

const tradeBadgeClass =
  'ml-auto inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-purple-400/20 text-purple-400 text-[9px] font-bold tabular-nums';

/** The 5 sub-page links for one league — shared by the expanded accordion and
 *  the collapsed flyout so they stay identical. */
function LeaguePages({ league, pending, onNavigate }: {
  league: League; pending: number; onNavigate?: () => void;
}) {
  return (
    <>
      {leaguePages.map(({ path, label, icon: Icon }) => {
        const to = `/league/${league.id}${path}`;
        const badge = path === '/market' ? pending : 0;
        return (
          <NavLink viewTransition
            key={path}
            to={to}
            end={path === ''}
            onClick={onNavigate}
            className={({ isActive }) => cn(
              'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors',
              isActive
                ? 'text-text-primary font-medium'
                : 'text-text-muted hover:bg-surface-overlay/60 hover:text-text-secondary',
            )}
            style={({ isActive }) => isActive ? {
              backgroundColor: `${league.color}15`,
              color: league.color,
            } : undefined}
          >
            <Icon size={14} />
            {label}
            {badge > 0 && (
              <span
                title={`${badge} pending trade proposal${badge === 1 ? '' : 's'}`}
                className={tradeBadgeClass}
              >
                {badge}
              </span>
            )}
          </NavLink>
        );
      })}
    </>
  );
}

/** Collapsed-rail league: a gem-tinted square that opens a flyout with the
 *  league's sub-pages. Holds its own open state so a link click can close it. */
function CollapsedLeagueItem({ league, pending, active }: {
  league: League; pending: number; active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const short = league.name.replace(' League', '');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(props) => (
          <button
            {...props}
            title={short}
            className={cn(
              'relative w-9 h-9 mx-auto rounded-md flex items-center justify-center font-mono text-[11px] font-bold transition-all',
              !active && 'hover:brightness-150',
            )}
            style={{
              backgroundColor: `${league.color}22`,
              color: league.color,
              boxShadow: active ? `0 0 0 2px ${league.color}` : undefined,
            }}
          >
            {short.slice(0, 2).toUpperCase()}
            {pending > 0 && (
              <span
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-purple-400 ring-2 ring-surface-raised"
                title={`${pending} pending trade proposal${pending === 1 ? '' : 's'}`}
              />
            )}
          </button>
        )}
      />
      <PopoverContent side="right" align="start" sideOffset={10} className="w-52 p-1.5 gap-1">
        <div className="flex items-center gap-2 px-1.5 py-1">
          <span className="font-heading text-sm font-semibold truncate" style={{ color: league.color }}>
            {short}
          </span>
          <span className={cn(
            'ml-auto text-[9px] px-1 py-0.5 rounded font-bold uppercase shrink-0',
            PHASE_COLORS[league.season.phase],
          )}>
            {phaseLabel(league)}
          </span>
        </div>
        <div className="h-px bg-border-subtle mx-1" />
        <div className="space-y-0.5">
          <LeaguePages league={league} pending={pending} onNavigate={() => setOpen(false)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SidebarLeagueNav({ leagues, openLeagueId, onToggle, pendingByLeague, collapsed }: SidebarLeagueNavProps) {
  const tilt = usePointerTilt();
  const { pathname } = useLocation();

  if (collapsed) {
    return (
      <div className="space-y-1">
        {leagues.map(league => (
          <CollapsedLeagueItem
            key={league.id}
            league={league}
            pending={pendingByLeague[league.id] ?? 0}
            active={pathname.includes(`/league/${league.id}`)}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {leagues.map(league => {
        const isOpen = openLeagueId === league.id;

        return (
          <div key={league.id}>
            {/* League header — accordion toggle */}
            <button
              onClick={() => onToggle(league.id)}
              className="gem-wrapper gem-3d w-full flex items-center gap-1.5 py-1.5 px-1 transition-all duration-150"
            >
              <div
                {...tilt}
                className={`league-banner league-banner-${leagueGem(league.id)} flex-1 min-w-0`}
              >
                <span className="league-banner-text text-white truncate">
                  {league.name.replace(' League', '')}
                </span>
              </div>
              <span className={cn(
                'text-[9px] px-1 py-0.5 rounded font-bold uppercase shrink-0',
                PHASE_COLORS[league.season.phase],
              )}>
                {phaseLabel(league)}
              </span>
              <ChevronDown
                size={14}
                className={cn(
                  'text-text-muted transition-transform duration-200 shrink-0',
                  isOpen && 'rotate-180',
                )}
              />
            </button>

            {/* Collapsible sub-pages */}
            <div className={cn(
              'grid transition-all duration-200 ease-out',
              isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}>
              <div className="overflow-hidden">
                <div className="pl-4 space-y-0.5 py-1">
                  <LeaguePages league={league} pending={pendingByLeague[league.id] ?? 0} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
