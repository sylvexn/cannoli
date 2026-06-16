/**
 * Market hub — the unified home for acquiring Pokemon. Two tabs (Trade Block,
 * Free Agents) share one header: page title, the viewer's team + budget, the
 * trade/FA deadline, and (for staff) the "acting as" team picker. The resolved
 * acting team flows to both tabs via outlet context so neither has to re-derive
 * it.
 */
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { ArrowLeftRight, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { isStaff, isTeamOwner } from '@/lib/permissions';
import { getEffectiveCost, DEFAULT_FORMAT } from '@/data/tier-list';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BudgetBar } from '@/pages/free-agents/budget-bar';
import { DeadlineBadge } from './trade-bits';

export interface MarketOutletContext {
  /** Team the viewer is acting as (owned, or staff-selected). undefined if none. */
  actingTeam: Player | undefined;
}

export function useMarket() {
  return useOutletContext<MarketOutletContext>();
}

function teamPointsUsed(team: Player, format = DEFAULT_FORMAT): number {
  return team.roster.reduce((sum, r) => sum + getEffectiveCost(r.name, r.isTeraCaptain, format), 0);
}

export function MarketLayout() {
  const { user } = useAuth();
  const league = useLeague();
  const { players } = useLeagueData();
  const userIsStaff = isStaff(user);
  const costFormat = league.costFormat ?? DEFAULT_FORMAT;

  const currentWeek = league.season.currentWeek;
  const tradeDeadlineWeek = league.season.tradeDeadlineWeek ?? 7;
  const pointCap = league.season.pointCap ?? 110;

  // The viewer's owned team in this league (if any).
  const ownedTeam = useMemo(
    () => (user ? players.find(p => isTeamOwner(user, p)) : undefined),
    [players, user],
  );

  // Staff can act on any team — default to their owned team here, else first.
  const [actingTeamId, setActingTeamId] = useState<string | null>(null);
  useEffect(() => {
    if (!userIsStaff) return;
    if (actingTeamId && players.some(p => p.id === actingTeamId)) return;
    setActingTeamId(ownedTeam?.id ?? players[0]?.id ?? null);
  }, [userIsStaff, players, ownedTeam, actingTeamId]);

  const actingTeam: Player | undefined = useMemo(() => {
    if (userIsStaff) return players.find(p => p.id === actingTeamId) ?? ownedTeam;
    return ownedTeam;
  }, [userIsStaff, players, actingTeamId, ownedTeam]);

  const tabCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
      isActive
        ? 'bg-surface-overlay text-text-primary'
        : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/50',
    );
  const tabStyle = ({ isActive }: { isActive: boolean }) =>
    isActive ? { color: league.color, backgroundColor: `${league.color}1a` } : undefined;

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Title + deadline */}
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase leading-none">
            <span style={{ color: league.color }}>Mar</span>
            <span className="text-text-primary">ket</span>
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Season {league.season.seasonNumber} · trades &amp; free agents
          </p>
        </div>
        <DeadlineBadge deadlineWeek={tradeDeadlineWeek} currentWeek={currentWeek} />
      </div>

      {/* Tabs + staff acting-as picker */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <nav className="flex items-center gap-1 p-1 rounded-lg bg-surface-raised border border-border-subtle">
          <NavLink to="trades" className={tabCls} style={tabStyle}>
            <ArrowLeftRight size={13} />
            Trade Block
          </NavLink>
          <NavLink to="free-agents" className={tabCls} style={tabStyle}>
            <UserPlus size={13} />
            Free Agents
          </NavLink>
        </nav>

        {userIsStaff && players.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-mono">Acting as</span>
            <Select value={actingTeam?.id ?? ''} onValueChange={setActingTeamId}>
              <SelectTrigger className="h-7 w-[240px] text-xs bg-surface border-border-subtle">
                {/* Render function — base-ui's Select.Value shows the raw value
                    (team id) unless given a formatter, since items use id values. */}
                <SelectValue placeholder="Pick a team...">
                  {(value: string) => {
                    const p = value ? players.find(o => o.id === value) : null;
                    return p ? `${p.teamAbbrev} — ${p.teamName}` : 'Pick a team...';
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {players.map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.teamAbbrev} — {p.teamName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Budget bar — only when the viewer is acting as a team */}
      {actingTeam && (
        <BudgetBar
          used={teamPointsUsed(actingTeam, costFormat)}
          cap={pointCap}
          projected={null}
          teamColor={actingTeam.teamColor}
          teamName={actingTeam.teamName}
        />
      )}

      <div className="flex-1 min-h-0">
        <Outlet context={{ actingTeam } satisfies MarketOutletContext} />
      </div>
    </div>
  );
}
