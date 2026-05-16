import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiTeam, ApiTrade, ApiSchedule, ApiMatch } from '@/lib/api';
import type { League } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { RecordDisplay } from '@/components/record-display';
import { EmptyState } from '@/components/empty-state';
import { PHASE_COLORS, TYPE_COLORS, TYPE_ABBR } from '@/lib/constants';
import {
  Calendar, ArrowLeftRight, UserPlus, Star, Hourglass, Swords, ChevronRight,
  ExternalLink, Trophy, FlaskConical, BarChart3, LayoutDashboard, Lock,
  Clock, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MyTeamEntry {
  league: League;
  team: ApiTeam;
  teams: ApiTeam[];
  schedule: ApiSchedule;
  rank: number;
  totalTeams: number;
}

export function MePage() {
  const { user, isLoading } = useAuth();
  const { leagues } = useAppData();

  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [tradesPerLeague, setTradesPerLeague] = useState<Record<string, ApiTrade[]>>({});
  const [schedulePerLeague, setSchedulePerLeague] = useState<Record<string, ApiSchedule>>({});
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (leagues.length === 0) return;
    setLoadingData(true);
    Promise.all([
      Promise.all(leagues.map(l => api.getTeams(l.id).catch(() => []).then(t => [l.id, t] as const))),
      Promise.all(leagues.map(l => api.getTrades(l.id).catch(() => []).then(t => [l.id, t] as const))),
      Promise.all(leagues.map(l => api.getSchedule(l.id).catch(() => ({ matches: [], byes: [] })).then(s => [l.id, s] as const))),
    ]).then(([t, tr, sc]) => {
      setTeamsPerLeague(Object.fromEntries(t));
      setTradesPerLeague(Object.fromEntries(tr));
      setSchedulePerLeague(Object.fromEntries(sc));
    }).finally(() => setLoadingData(false));
  }, [leagues]);

  // Find user's team in each league + compute rank
  const myTeams = useMemo<MyTeamEntry[]>(() => {
    if (!user) return [];
    const out: MyTeamEntry[] = [];
    for (const league of leagues) {
      const teams = teamsPerLeague[league.id] || [];
      const idx = teams.findIndex(t => t.userId != null && String(t.userId) === user.id);
      if (idx >= 0) {
        out.push({
          league,
          team: teams[idx],
          teams,
          schedule: schedulePerLeague[league.id] || { matches: [], byes: [] },
          rank: idx + 1, // backend already returns ordered by tiebreaker
          totalTeams: teams.length,
        });
      }
    }
    return out;
  }, [user, leagues, teamsPerLeague, schedulePerLeague]);

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
          <span className="text-neon">My</span>{' '}
          <span className="text-text-primary">Hub</span>
        </h1>
        <p className="text-sm text-text-muted">
          Welcome back, {user.username}.
        </p>
      </div>

      {/* No teams — guide them */}
      {!loadingData && myTeams.length === 0 && (
        <Card className="bg-surface-raised border-border-default">
          <CardContent className="py-2">
            <EmptyState
              variant="coming-soon"
              title="No team yet."
              subtitle="You don't manage a team in any active league."
              action={
                <Link to="/" className="text-neon hover:underline text-xs inline-block">
                  Browse leagues →
                </Link>
              }
              spriteSize="md"
              padding="sm"
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* My Teams (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted">
            My Teams
          </h2>
          {myTeams.map((entry, i) => (
            <MyTeamCard key={entry.league.id} entry={entry} index={i} />
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
                <EmptyState
                  variant="quiet"
                  title="No pending proposals."
                  spriteSize="md"
                  padding="sm"
                />
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
            <CardContent className="space-y-1 text-xs">
              {myTeams.length === 0 ? (
                <p className="text-text-muted">Nothing assigned yet.</p>
              ) : (
                <ActionItemList myTeams={myTeams} pendingTradesForMe={pendingTradesForMe} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── My Team Card (richer) ────────────────────────────────────────────

function MyTeamCard({ entry, index }: { entry: MyTeamEntry; index: number }) {
  const { league, team, teams, schedule, rank, totalTeams } = entry;
  const phase = league.season.phase;
  const captains = team.roster.filter(r => r.isTeraCaptain);

  // This-week match for the team
  const teamMatches = useMemo(() =>
    schedule.matches
      .filter(m => m.homePlayer === team.id || m.awayPlayer === team.id)
      .sort((a, b) => a.week - b.week),
    [schedule.matches, team.id],
  );
  const teamByes = useMemo(() =>
    new Set(schedule.byes.filter(b => b.teamId === team.id).map(b => b.week)),
    [schedule.byes, team.id],
  );
  const currentWeek = league.season.currentWeek;
  const showMatchup = phase === 'regular' || phase === 'playoffs';

  // "this week" = current week match. Fall back to next unplayed match.
  const thisWeekMatch = teamMatches.find(m => m.week === currentWeek);
  const nextMatch = teamMatches.find(m =>
    m.week > currentWeek && m.homeScore == null && m.awayScore == null,
  );
  const isThisWeekBye = teamByes.has(currentWeek);

  return (
    <Card
      className="stagger-item card-interactive bg-surface-raised border-border-default overflow-hidden"
      style={{
        ['--i' as never]: Math.min(index, 20),
        ['--card-accent' as never]: league.color,
        ['--card-glow' as never]: `${league.color}30`,
      }}
    >
      <div className="h-1" style={{ backgroundColor: league.color }} />
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="md" />
          <div className="min-w-0 flex-1">
            <Link
              to={`/league/${league.id}/teams/${team.id}`}
              className="text-base font-medium text-text-primary hover:text-neon transition-colors block truncate"
            >
              {team.teamName}
            </Link>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Link
                to={`/league/${league.id}`}
                className="text-[11px] hover:underline"
                style={{ color: league.color }}
              >
                {league.name.replace(' League', '')}
              </Link>
              <Badge variant="outline" className={cn('text-[10px]', PHASE_COLORS[phase])}>
                {phase}
                {phase === 'regular' && ` · W${currentWeek}`}
                {phase === 'playoffs' && ` · W${currentWeek}`}
              </Badge>
              {(phase === 'regular' || phase === 'playoffs' || phase === 'offseason') && (
                <span className="text-[10px] text-text-muted inline-flex items-center gap-1">
                  <Trophy size={9} />
                  #{rank}
                  <span className="text-text-muted/40">/ {totalTeams}</span>
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <RecordDisplay
              wins={team.record.wins}
              losses={team.record.losses}
              differential={team.record.differential}
              className="text-xs"
            />
            {team.record.kills != null && team.record.deaths != null && (
              <div className="text-[10px] font-mono text-text-muted mt-0.5 tabular-nums">
                <span className="text-win">{team.record.kills}</span>
                <span className="text-text-muted/40 mx-0.5">/</span>
                <span className="text-loss">{team.record.deaths}</span>
              </div>
            )}
          </div>
        </div>

        {/* Roster sprite strip */}
        {team.roster.length > 0 && (
          <Link
            to={`/league/${league.id}/teams/${team.id}`}
            className="flex items-center justify-center gap-0.5 flex-wrap py-1 -mx-1 px-1 rounded-md hover:bg-surface-overlay/40 transition-colors group"
            title="View full roster"
          >
            {team.roster.map(mon => (
              <div
                key={mon.name}
                className="relative shrink-0"
              >
                <PokemonSprite
                  name={mon.name}
                  size="sm"
                  shiny={mon.isShiny}
                  className="transition-transform group-hover:scale-105"
                />
                {mon.isTeraCaptain && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-surface-base"
                    style={{ backgroundColor: '#e879f9' }}
                  />
                )}
              </div>
            ))}
          </Link>
        )}

        {/* Captain preview row */}
        {captains.length > 0 && (
          <div className="flex items-center gap-3 px-1 text-[10px]">
            <span className="font-mono uppercase tracking-wider text-text-muted shrink-0">
              <Star size={9} className="inline -mt-0.5 mr-0.5 fill-yellow-400 text-yellow-400" />
              Captains
            </span>
            <div className="flex items-center gap-3 flex-wrap">
              {captains.map(cap => (
                <span key={cap.name} className="inline-flex items-center gap-1">
                  <span className="text-pink font-medium">{cap.name}</span>
                  {cap.teraTypes && cap.teraTypes.length > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      {cap.teraTypes.map(t => (
                        <span
                          key={t}
                          className="text-[7px] font-bold uppercase rounded px-1 py-px text-white"
                          style={{ backgroundColor: TYPE_COLORS[t as keyof typeof TYPE_COLORS] }}
                        >
                          {TYPE_ABBR[t as keyof typeof TYPE_ABBR]}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              ))}
              {captains.length < league.season.teraCaptainSlots && (
                <span className="text-text-muted/60 font-mono">
                  {captains.length}/{league.season.teraCaptainSlots}
                </span>
              )}
            </div>
          </div>
        )}

        {/* This-week matchup widget (regular/playoffs only) */}
        {showMatchup && (
          <MatchupWidget
            league={league}
            team={team}
            teams={teams}
            match={thisWeekMatch}
            nextMatch={nextMatch}
            isBye={isThisWeekBye}
          />
        )}

        {/* Quick links rail */}
        <div className="flex items-center gap-1 text-[10px] flex-wrap pt-1 border-t border-border-subtle/50">
          <QuickLink to={`/league/${league.id}/teams/${team.id}`}>Roster</QuickLink>
          <QuickLink
            to={`/league/${league.id}/teams/${team.id}?theorycraft=1`}
            icon={<FlaskConical size={10} />}
            color="text-pink"
          >
            Theorycraft
          </QuickLink>
          <QuickLink to={`/league/${league.id}/schedule`} icon={<Calendar size={10} />}>
            Schedule
          </QuickLink>
          <QuickLink to={`/league/${league.id}/trades`} icon={<ArrowLeftRight size={10} />}>
            Trades
          </QuickLink>
          <QuickLink to={`/league/${league.id}/free-agents`} icon={<UserPlus size={10} />}>
            Free Agents
          </QuickLink>
          <QuickLink to={`/league/${league.id}/stats`} icon={<BarChart3 size={10} />}>
            Stats
          </QuickLink>
          <QuickLink to={`/league/${league.id}/draft`} icon={<LayoutDashboard size={10} />}>
            Draft Board
          </QuickLink>
          <QuickLink
            to={`/matchup?leagueId=${league.id}&teamA=${team.id}`}
            icon={<Swords size={10} />}
            color="text-neon"
            className="ml-auto"
          >
            Scout
          </QuickLink>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Quick link pill ──────────────────────────────────────────────────

function QuickLink({
  to, icon, color, className, children,
}: {
  to: string;
  icon?: React.ReactNode;
  color?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'px-2 py-1 rounded-md bg-surface-overlay/50 hover:bg-neon/10 hover:text-neon transition-colors flex items-center gap-1',
        color ?? 'text-text-secondary',
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

// ─── Matchup widget ───────────────────────────────────────────────────

function MatchupWidget({
  league, team, teams, match, nextMatch, isBye,
}: {
  league: League;
  team: ApiTeam;
  teams: ApiTeam[];
  match: ApiMatch | undefined;
  nextMatch: ApiMatch | undefined;
  isBye: boolean;
}) {
  if (isBye) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-overlay/30 border border-border-subtle/40">
        <Calendar size={12} className="text-text-muted shrink-0" />
        <span className="text-xs text-text-muted">
          BYE this week. Next match shown below.
        </span>
      </div>
    );
  }

  const display = match ?? nextMatch;
  if (!display) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-overlay/30 border border-border-subtle/40">
        <Calendar size={12} className="text-text-muted shrink-0" />
        <span className="text-xs text-text-muted">No matches remaining.</span>
      </div>
    );
  }

  const isHome = display.homePlayer === team.id;
  const opponentId = isHome ? display.awayPlayer : display.homePlayer;
  const myScore = isHome ? display.homeScore : display.awayScore;
  const theirScore = isHome ? display.awayScore : display.homeScore;
  const completed = display.homeScore != null && display.awayScore != null;
  const won = completed && (myScore ?? 0) > (theirScore ?? 0);
  const lost = completed && (myScore ?? 0) < (theirScore ?? 0);

  const opponent = teams.find(t => t.id === opponentId) ?? null;

  return (
    <OpponentMatchupCard
      league={league}
      team={team}
      opponent={opponent}
      week={display.week}
      isUpcoming={display === nextMatch && !match}
      completed={completed}
      myScore={myScore ?? null}
      theirScore={theirScore ?? null}
      won={won}
      lost={lost}
      replayUrl={display.replayUrl}
    />
  );
}

function OpponentMatchupCard({
  league, team, opponent, week, isUpcoming, completed, myScore, theirScore, won, lost, replayUrl,
}: {
  league: League;
  team: ApiTeam;
  opponent: ApiTeam | null;
  week: number;
  isUpcoming: boolean;
  completed: boolean;
  myScore: number | null;
  theirScore: number | null;
  won: boolean;
  lost: boolean;
  replayUrl: string | null;
}) {
  const labelColor = won ? 'text-win' : lost ? 'text-loss' : isUpcoming ? 'text-neon' : 'text-pink';
  const label =
    completed ? (won ? 'WON' : lost ? 'LOST' : 'DRAW')
    : isUpcoming ? `NEXT · W${week}`
    : `THIS WEEK · W${week}`;

  return (
    <div className={cn(
      'flex items-center gap-3 px-3 py-2.5 rounded-md border',
      completed
        ? won ? 'bg-win/5 border-win/20'
          : lost ? 'bg-loss/5 border-loss/20'
          : 'bg-surface-overlay/40 border-border-subtle/40'
        : 'bg-neon/5 border-neon/20',
    )}>
      <span className={cn('text-[9px] font-mono font-bold uppercase tracking-widest shrink-0', labelColor)}>
        {label}
      </span>
      <span className="text-text-muted text-[11px]">vs</span>
      {opponent ? (
        <Link
          to={`/league/${league.id}/teams/${opponent.id}`}
          className="flex items-center gap-1.5 min-w-0 flex-1 hover:opacity-80 transition-opacity"
        >
          <TeamLogo abbrev={opponent.teamAbbrev} color={opponent.teamColor} size="sm" />
          <span className="text-xs font-medium text-text-primary truncate">
            {opponent.teamName}
          </span>
          <span className="text-[10px] text-text-muted font-mono shrink-0">
            ({opponent.record.wins}-{opponent.record.losses})
          </span>
        </Link>
      ) : (
        <span className="flex-1 text-text-muted text-xs">Loading opponent...</span>
      )}
      {completed && (
        <span className="font-mono text-xs tabular-nums shrink-0">
          <span className={won ? 'text-win font-bold' : 'text-text-secondary'}>{myScore}</span>
          <span className="text-text-muted/40 mx-0.5">-</span>
          <span className={lost ? 'text-loss font-bold' : 'text-text-secondary'}>{theirScore}</span>
        </span>
      )}
      <div className="flex items-center gap-1 shrink-0">
        {replayUrl && (
          <a
            href={replayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded text-text-muted hover:text-neon transition-colors"
            title="Replay"
          >
            <ExternalLink size={11} />
          </a>
        )}
        {!completed && opponent && (
          <Link
            to={`/matchup?leagueId=${league.id}&teamA=${team.id}&teamB=${opponent.id}`}
            className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-neon/10 text-neon hover:bg-neon/20 transition-colors flex items-center gap-1"
          >
            <Swords size={10} />
            Scout
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Action items ─────────────────────────────────────────────────────

interface ActionItem {
  key: string;
  leagueId: string;
  leagueColor: string;
  leagueLabel: string;
  icon: React.ReactNode;
  label: string;
  detail?: string;
  to: string;
  tone: 'neutral' | 'warn' | 'urgent' | 'good';
}

function ActionItemList({
  myTeams,
  pendingTradesForMe,
}: {
  myTeams: MyTeamEntry[];
  pendingTradesForMe: { leagueId: string; trade: ApiTrade }[];
}) {
  const items = useMemo<ActionItem[]>(() => {
    const out: ActionItem[] = [];

    // Pending trade proposals across all leagues — top priority
    for (const { leagueId, trade } of pendingTradesForMe) {
      const entry = myTeams.find(m => m.league.id === leagueId);
      if (!entry) continue;
      out.push({
        key: `trade-${trade.id}`,
        leagueId,
        leagueColor: entry.league.color,
        leagueLabel: entry.league.name.replace(' League', ''),
        icon: <ArrowLeftRight size={11} className="text-purple-400" />,
        label: 'Review trade proposal',
        detail: `+${trade.offering.join(', ')} / -${trade.requesting.join(', ')}`,
        to: `/league/${leagueId}/trades`,
        tone: 'urgent',
      });
    }

    for (const entry of myTeams) {
      const { league, team, schedule, rank } = entry;
      const phase = league.season.phase;
      const cw = league.season.currentWeek;
      const cap = team.roster.filter(r => r.isTeraCaptain).length;

      if (phase === 'predraft') {
        const draftDate = league.draftDate;
        const detail = draftDate ? formatDraftCountdown(draftDate) : undefined;
        out.push({
          key: `predraft-${league.id}`,
          leagueId: league.id,
          leagueColor: league.color,
          leagueLabel: league.name.replace(' League', ''),
          icon: <Calendar size={11} className="text-pink" />,
          label: 'Draft pending',
          detail,
          to: `/league/${league.id}/draft`,
          tone: 'neutral',
        });
        continue;
      }

      if (phase === 'draft') {
        // Captains need to be set after draft completes (captain-gate)
        if (!team.captainsLocked) {
          const slots = league.season.teraCaptainSlots;
          out.push({
            key: `captains-${league.id}`,
            leagueId: league.id,
            leagueColor: league.color,
            leagueLabel: league.name.replace(' League', ''),
            icon: <Star size={11} className="text-yellow-400" />,
            label: cap === 0 ? 'Pick Tera Captains' : `Lock in captains (${cap}/${slots})`,
            detail: 'League advances once every team locks.',
            to: `/league/${league.id}/teams/${team.id}`,
            tone: 'urgent',
          });
        } else {
          out.push({
            key: `draft-${league.id}`,
            leagueId: league.id,
            leagueColor: league.color,
            leagueLabel: league.name.replace(' League', ''),
            icon: <Lock size={11} className="text-text-muted" />,
            label: 'Captains locked — waiting on others',
            to: `/league/${league.id}`,
            tone: 'neutral',
          });
        }
        continue;
      }

      if (phase === 'regular' || phase === 'playoffs') {
        // Look for a "this-week" match where we are the home/away team
        const teamMatches = schedule.matches.filter(
          m => m.homePlayer === team.id || m.awayPlayer === team.id,
        );
        const thisWeekMatch = teamMatches.find(m => m.week === cw);
        const completed = thisWeekMatch?.homeScore != null && thisWeekMatch?.awayScore != null;
        const isBye = schedule.byes.some(b => b.teamId === team.id && b.week === cw);

        if (isBye) {
          out.push({
            key: `bye-${league.id}`,
            leagueId: league.id,
            leagueColor: league.color,
            leagueLabel: league.name.replace(' League', ''),
            icon: <Calendar size={11} className="text-text-muted" />,
            label: `Week ${cw} BYE`,
            to: `/league/${league.id}/schedule`,
            tone: 'neutral',
          });
        } else if (thisWeekMatch && !completed) {
          out.push({
            key: `match-${league.id}-${thisWeekMatch.id}`,
            leagueId: league.id,
            leagueColor: league.color,
            leagueLabel: league.name.replace(' League', ''),
            icon: <Swords size={11} className="text-neon" />,
            label: `Week ${cw} match — awaiting result`,
            to: `/league/${league.id}/teams/${team.id}`,
            tone: 'warn',
          });
        }

        // Trade deadline reminder (regular phase only)
        if (phase === 'regular') {
          const tdw = league.season.tradeDeadlineWeek;
          if (cw < tdw) {
            const weeksLeft = tdw - cw;
            out.push({
              key: `tradedl-${league.id}`,
              leagueId: league.id,
              leagueColor: league.color,
              leagueLabel: league.name.replace(' League', ''),
              icon: <Clock size={11} className="text-text-muted" />,
              label: weeksLeft === 1
                ? 'Trade deadline next week'
                : `${weeksLeft} weeks until trade deadline`,
              detail: `Through W${tdw}.`,
              to: `/league/${league.id}/trades`,
              tone: weeksLeft <= 1 ? 'warn' : 'neutral',
            });
          } else if (cw === tdw) {
            out.push({
              key: `tradedl-${league.id}`,
              leagueId: league.id,
              leagueColor: league.color,
              leagueLabel: league.name.replace(' League', ''),
              icon: <AlertCircle size={11} className="text-loss" />,
              label: 'Trade deadline this week',
              to: `/league/${league.id}/trades`,
              tone: 'urgent',
            });
          }
        }

        // Playoffs context
        if (phase === 'playoffs') {
          out.push({
            key: `playoffs-${league.id}`,
            leagueId: league.id,
            leagueColor: league.color,
            leagueLabel: league.name.replace(' League', ''),
            icon: <Trophy size={11} className="text-pink" />,
            label: `Playoffs — seed #${rank}`,
            to: `/league/${league.id}/schedule`,
            tone: 'good',
          });
        }
        continue;
      }

      if (phase === 'offseason') {
        out.push({
          key: `offseason-${league.id}`,
          leagueId: league.id,
          leagueColor: league.color,
          leagueLabel: league.name.replace(' League', ''),
          icon: <Trophy size={11} className="text-text-muted" />,
          label: `Final: #${rank} (${team.record.wins}-${team.record.losses})`,
          to: `/league/${league.id}`,
          tone: 'neutral',
        });
      }
    }

    return out;
  }, [myTeams, pendingTradesForMe]);

  if (items.length === 0) {
    return <p className="text-text-muted">Nothing waiting on you.</p>;
  }

  return (
    <>
      {items.map(item => (
        <Link
          key={item.key}
          to={item.to}
          className={cn(
            'group flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors',
            item.tone === 'urgent' ? 'bg-loss/5 hover:bg-loss/10' :
            item.tone === 'warn' ? 'bg-yellow-400/5 hover:bg-yellow-400/10' :
            item.tone === 'good' ? 'hover:bg-surface-overlay/60' :
            'hover:bg-surface-overlay/60',
          )}
        >
          <span className="shrink-0">{item.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium" style={{ color: item.leagueColor }}>
                {item.leagueLabel}
              </span>
              <span className={cn(
                'text-[11px] font-medium truncate',
                item.tone === 'urgent' ? 'text-loss' :
                item.tone === 'warn' ? 'text-yellow-400' :
                item.tone === 'good' ? 'text-pink' :
                'text-text-secondary',
              )}>
                {item.label}
              </span>
            </div>
            {item.detail && (
              <div className="text-[9px] text-text-muted truncate">{item.detail}</div>
            )}
          </div>
          <ChevronRight size={11} className="ml-auto text-text-muted/40 group-hover:text-text-muted transition-colors shrink-0" />
        </Link>
      ))}
    </>
  );
}

function formatDraftCountdown(iso: string): string | undefined {
  const target = new Date(iso).getTime();
  if (isNaN(target)) return undefined;
  const ms = target - Date.now();
  if (ms < 0) return 'Draft overdue';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  if (days > 1) return `In ${days} days`;
  if (days === 1) return `Tomorrow`;
  if (hours > 1) return `In ${hours} hours`;
  return 'Starting soon';
}
