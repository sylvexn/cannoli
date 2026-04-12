import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiTeam, ApiTrade } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { PHASE_COLORS } from '@/lib/constants';
import {
  User as UserIcon, Calendar, ArrowLeftRight, UserPlus, Star,
  Hourglass, Swords, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MyTeamEntry {
  league: { id: string; name: string; color: string; phase: string; currentWeek: number; totalWeeks: number };
  team: ApiTeam;
}

export function MePage() {
  const { user, isLoading } = useAuth();
  const { leagues } = useAppData();

  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [tradesPerLeague, setTradesPerLeague] = useState<Record<string, ApiTrade[]>>({});
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (leagues.length === 0) return;
    setLoadingData(true);
    Promise.all([
      Promise.all(leagues.map(l => api.getTeams(l.id).catch(() => []).then(t => [l.id, t] as const))),
      Promise.all(leagues.map(l => api.getTrades(l.id).catch(() => []).then(t => [l.id, t] as const))),
    ]).then(([t, tr]) => {
      setTeamsPerLeague(Object.fromEntries(t));
      setTradesPerLeague(Object.fromEntries(tr));
    }).finally(() => setLoadingData(false));
  }, [leagues]);

  // Find user's team in each league
  const myTeams = useMemo<MyTeamEntry[]>(() => {
    if (!user) return [];
    const out: MyTeamEntry[] = [];
    for (const league of leagues) {
      const teams = teamsPerLeague[league.id] || [];
      const team = teams.find(t => t.userId != null && String(t.userId) === user.id);
      if (team) {
        out.push({
          league: {
            id: league.id,
            name: league.name,
            color: league.color,
            phase: league.season.phase,
            currentWeek: league.season.currentWeek,
            totalWeeks: league.season.totalWeeks,
          },
          team,
        });
      }
    }
    return out;
  }, [user, leagues, teamsPerLeague]);

  // Pending trades to me (where I am the recipient and status=pending)
  const pendingTradesForMe = useMemo(() => {
    const myTeamIds = new Set(myTeams.map(m => m.team.id));
    return Object.entries(tradesPerLeague).flatMap(([leagueId, trades]) =>
      trades
        .filter(t => myTeamIds.has(t.recipientId) && (t.status === 'pending' || t.status === 'awaiting_admin'))
        .map(t => ({ leagueId, trade: t })),
    );
  }, [tradesPerLeague, myTeams]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  // Guests: send to League Overview
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-neon">My</span>
          <span className="text-text-primary ml-1">Hub</span>
        </h1>
        <p className="text-sm text-text-muted">
          Welcome back, {user.username}.
        </p>
      </div>

      {/* No teams — guide them */}
      {!loadingData && myTeams.length === 0 && (
        <Card className="bg-surface-raised border-border-default">
          <CardContent className="py-6 text-sm text-text-muted text-center">
            <UserIcon size={20} className="inline mb-2 text-text-muted" />
            <div>You don't manage a team in any active league yet.</div>
            <Link to="/" className="text-neon hover:underline text-xs mt-1 inline-block">
              Browse leagues →
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* My Teams (2 cols) */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-text-muted">
            My Teams
          </h2>
          {myTeams.map(({ league, team }) => (
            <MyTeamCard key={league.id} league={league} team={team} />
          ))}
        </div>

        {/* Right column: actions */}
        <div className="space-y-3">
          {/* Pending trades to me */}
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowLeftRight size={14} className="text-purple-400" />
                Pending Trades
                {pendingTradesForMe.length > 0 && (
                  <Badge className="ml-auto bg-purple-400/15 text-purple-400 border-purple-400/30 text-[10px]">
                    {pendingTradesForMe.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {pendingTradesForMe.length === 0 ? (
                <p className="text-xs text-text-muted">No pending proposals.</p>
              ) : (
                pendingTradesForMe.slice(0, 5).map(({ leagueId, trade }) => {
                  const league = leagues.find(l => l.id === leagueId);
                  return (
                    <Link
                      key={trade.id}
                      to={`/league/${leagueId}/trades`}
                      className="block px-2 py-1.5 rounded-md hover:bg-surface-overlay/60 transition-colors group"
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium" style={{ color: league?.color }}>
                          {league?.name.replace(' League', '')}
                        </span>
                        <span className="text-text-muted">W{trade.week}</span>
                        <ChevronRight size={12} className="ml-auto text-text-muted group-hover:text-neon" />
                      </div>
                      <div className="text-[10px] text-text-muted truncate mt-0.5">
                        +{trade.offering.join(', ')} / -{trade.requesting.join(', ')}
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Phase-aware reminders per league */}
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Hourglass size={14} className="text-draw" />
                Action Items
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              {myTeams.length === 0 ? (
                <p className="text-text-muted">Nothing assigned yet.</p>
              ) : (
                myTeams.map(({ league, team }) => (
                  <ActionItemRow key={league.id} league={league} team={team} />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MyTeamCard({ league, team }: MyTeamEntry) {
  const draftedCount = team.roster.length;
  const captainCount = team.roster.filter(r => r.isTeraCaptain).length;

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      <div className="h-1" style={{ backgroundColor: league.color }} />
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="md" />
          <div className="min-w-0 flex-1">
            <Link
              to={`/league/${league.id}/teams/${team.id}`}
              className="text-base font-medium text-text-primary hover:text-neon transition-colors block truncate"
            >
              {team.teamName}
            </Link>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px]" style={{ color: league.color }}>
                {league.name.replace(' League', '')}
              </span>
              <Badge variant="outline" className={cn('text-[10px]', PHASE_COLORS[league.phase as keyof typeof PHASE_COLORS])}>
                {league.phase}
                {league.phase === 'regular' && ` · W${league.currentWeek}`}
              </Badge>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <RecordDisplay
              wins={team.record.wins}
              losses={team.record.losses}
              differential={team.record.differential}
              className="text-xs"
            />
          </div>
        </div>

        {/* Quick stats row */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border-subtle/50">
          <div className="text-center">
            <div className="text-base font-mono font-bold text-text-primary tabular-nums">
              {draftedCount}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider">
              Roster
            </div>
          </div>
          <div className="text-center">
            <div className="text-base font-mono font-bold text-yellow-400 tabular-nums flex items-center justify-center gap-1">
              <Star size={11} className="fill-yellow-400" />
              {captainCount}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider">
              Captains
            </div>
          </div>
          <div className="text-center">
            <Link
              to={`/league/${league.id}/free-agents`}
              className="block text-base font-mono font-bold text-neon hover:text-neon/80 transition-colors tabular-nums"
            >
              FA
            </Link>
            <div className="text-[9px] text-text-muted uppercase tracking-wider">
              Pickup
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div className="flex items-center gap-1.5 text-[11px] pt-1">
          <Link
            to={`/league/${league.id}/teams/${team.id}`}
            className="px-2 py-1 rounded-md bg-surface-overlay/60 hover:bg-neon/10 hover:text-neon text-text-secondary transition-colors"
          >
            Roster
          </Link>
          <Link
            to={`/league/${league.id}/schedule`}
            className="px-2 py-1 rounded-md bg-surface-overlay/60 hover:bg-neon/10 hover:text-neon text-text-secondary transition-colors flex items-center gap-1"
          >
            <Calendar size={11} />
            Schedule
          </Link>
          <Link
            to={`/league/${league.id}/trades`}
            className="px-2 py-1 rounded-md bg-surface-overlay/60 hover:bg-neon/10 hover:text-neon text-text-secondary transition-colors flex items-center gap-1"
          >
            <ArrowLeftRight size={11} />
            Trades
          </Link>
          <Link
            to={`/matchup?leagueId=${league.id}&teamA=${team.id}`}
            className="px-2 py-1 rounded-md bg-surface-overlay/60 hover:bg-neon/10 hover:text-neon text-text-secondary transition-colors flex items-center gap-1 ml-auto"
          >
            <Swords size={11} />
            Scout
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionItemRow({ league, team }: MyTeamEntry) {
  const captainCount = team.roster.filter(r => r.isTeraCaptain).length;
  // Captain assignment hint during draft
  const needsCaptains = league.phase === 'draft' && captainCount === 0;
  // Pre-draft countdown — handled via league.draftDate (passed by App)

  let icon = <Hourglass size={11} className="text-text-muted" />;
  let label = 'Standings';
  let color = 'text-text-muted';
  let to = `/league/${league.id}`;

  if (league.phase === 'predraft') {
    icon = <Calendar size={11} className="text-pink" />;
    label = 'Draft pending';
    color = 'text-pink';
    to = `/league/${league.id}/draft`;
  } else if (league.phase === 'draft') {
    icon = <Star size={11} className="text-yellow-400" />;
    label = needsCaptains ? 'Pick Tera Captains' : 'Draft in progress';
    color = needsCaptains ? 'text-yellow-400' : 'text-neon';
    to = `/league/${league.id}/draft`;
  } else if (league.phase === 'regular') {
    icon = <Swords size={11} className="text-neon" />;
    label = `Week ${league.currentWeek} of ${league.totalWeeks}`;
    color = 'text-neon';
    to = `/league/${league.id}/schedule`;
  } else if (league.phase === 'playoffs') {
    icon = <Swords size={11} className="text-pink" />;
    label = 'Playoffs';
    color = 'text-pink';
    to = `/league/${league.id}/schedule`;
  } else if (league.phase === 'offseason') {
    icon = <UserPlus size={11} className="text-text-muted" />;
    label = 'Offseason';
    color = 'text-text-muted';
  }

  return (
    <Link
      to={to}
      className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-overlay/60 transition-colors group"
    >
      {icon}
      <span className="text-[11px]" style={{ color: league.color }}>
        {league.name.replace(' League', '')}
      </span>
      <span className={cn('text-[11px] font-medium', color)}>{label}</span>
      <ChevronRight size={11} className="ml-auto text-text-muted/40 group-hover:text-text-muted transition-colors" />
    </Link>
  );
}
