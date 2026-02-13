import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiTeam } from '@/lib/api';
import { mockActivityLog } from '@/mocks/activity-log';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { cn } from '@/lib/utils';
import type { ActivityEvent } from '@/lib/types';
import {
  Megaphone, Users, Swords, ArrowLeftRight, Trophy,
  ScrollText, Settings, Play, Check, Star, X,
} from 'lucide-react';

const phaseColors: Record<string, string> = {
  draft: 'text-draw bg-draw/10',
  regular: 'text-neon bg-neon/10',
  playoffs: 'text-pink bg-pink/10',
  offseason: 'text-text-muted bg-surface-overlay',
};

const EVENT_ICONS: Record<string, typeof Users> = {
  draft_started: Play, draft_pick: Trophy, draft_completed: Check,
  trade_proposed: ArrowLeftRight, trade_approved: Check, trade_rejected: X,
  match_reported: Swords, tera_captain_set: Star, tera_types_changed: Star,
};

// League-relevant categories for the public feed
const FEED_CATEGORIES = new Set(['draft', 'trade', 'match', 'team']);

export function LeagueOverviewPage() {
  const { leagues, loading } = useAppData();
  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [teamsLoading, setTeamsLoading] = useState(true);

  // Fetch teams for all leagues
  useEffect(() => {
    if (leagues.length === 0) return;
    setTeamsLoading(true);
    Promise.all(
      leagues.map(l => api.getTeams(l.id).then(teams => [l.id, teams] as const))
    ).then(results => {
      setTeamsPerLeague(Object.fromEntries(results));
      setTeamsLoading(false);
    }).catch(() => setTeamsLoading(false));
  }, [leagues]);

  // Compute site-wide stats from fetched teams
  const allTeams = Object.values(teamsPerLeague).flat();
  const totalPlayers = allTeams.length;
  const totalDrafted = allTeams.reduce((s, t) => s + t.roster.length, 0);
  const totalMatches = allTeams.reduce((s, t) => s + t.record.wins + t.record.losses, 0) / 2;

  // Recent activity — league events only (draft, trade, match, team)
  const recentActivity = useMemo(() =>
    [...mockActivityLog]
      .filter(e => FEED_CATEGORIES.has(e.category))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8),
    [],
  );

  // Mock announcement (would come from site settings in real app)
  const announcement = {
    enabled: true,
    text: 'Trade deadline is Week 8 — get your offers in!',
    type: 'warning' as const,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted text-sm">
        Loading leagues...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-neon">League</span>
          <span className="text-text-primary ml-1">Overview</span>
        </h1>
        <p className="text-sm text-text-muted">{leagues.length} active leagues</p>
      </div>

      {/* Announcement Banner */}
      {announcement.enabled && (
        <AnnouncementBanner text={announcement.text} type={announcement.type} />
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Players" value={totalPlayers} color="text-neon" loading={teamsLoading} />
        <StatCard icon={Trophy} label="Pokemon Drafted" value={totalDrafted} color="text-draw" loading={teamsLoading} />
        <StatCard icon={ArrowLeftRight} label="Trades" value={0} color="text-purple-400" loading={false} />
        <StatCard icon={Swords} label="Matches Played" value={Math.floor(totalMatches)} color="text-win" loading={teamsLoading} />
      </div>

      {/* Main content: League cards + Activity feed */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* League cards (3 cols on xl) */}
        <div className="xl:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {leagues.map(league => {
            const teams = teamsPerLeague[league.id] || [];
            const standings = [...teams].sort(
              (a, b) => b.record.wins - a.record.wins || b.record.differential - a.record.differential,
            );

            return (
              <Card key={league.id} className="bg-surface-raised border-border-default overflow-hidden">
                <div className="h-1" style={{ backgroundColor: league.color }} />

                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <Link to={`/league/${league.id}`} className="hover:opacity-80 transition-opacity">
                      <CardTitle className="text-base font-heading" style={{ color: league.color }}>
                        {league.name}
                      </CardTitle>
                    </Link>
                    <Badge variant="outline" className={cn('text-[10px]', phaseColors[league.season.phase])}>
                      {league.season.phase}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-text-muted">
                    Season {league.season.seasonNumber}
                    {league.season.currentWeek > 0 && ` · Week ${league.season.currentWeek} of ${league.season.totalWeeks}`}
                  </p>
                </CardHeader>

                <CardContent>
                  {teamsLoading ? (
                    <div className="text-center py-6 text-text-muted text-sm">Loading...</div>
                  ) : standings.length > 0 ? (
                    <div className="space-y-1">
                      {standings.slice(0, 6).map((team, i) => (
                        <Link
                          key={team.id}
                          to={`/league/${league.id}/teams/${team.id}`}
                          className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-surface-overlay/60 transition-colors group"
                        >
                          <span className={cn(
                            'text-[10px] font-bold tabular-nums w-4 text-center',
                            i < 3 ? 'text-neon' : 'text-text-muted',
                          )}>
                            {i + 1}
                          </span>
                          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                          <span className="text-xs text-text-primary group-hover:text-neon transition-colors truncate flex-1">
                            {team.teamAbbrev}
                          </span>
                          <RecordDisplay
                            wins={team.record.wins}
                            losses={team.record.losses}
                            differential={team.record.differential}
                            className="text-[10px]"
                          />
                        </Link>
                      ))}
                      <Link
                        to={`/league/${league.id}`}
                        className="block text-center text-[10px] text-text-muted hover:text-neon transition-colors pt-1"
                      >
                        View full standings →
                      </Link>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-text-muted text-sm">
                      Coming soon
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Activity Feed sidebar */}
        <div className="xl:col-span-1">
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-heading flex items-center gap-2">
                <ScrollText size={14} className="text-text-muted" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {recentActivity.map(event => (
                  <ActivityFeedItem key={event.id} event={event} />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, loading }: {
  icon: typeof Users;
  label: string;
  value: number;
  color: string;
  loading: boolean;
}) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="py-3 px-4 flex items-center gap-3">
        <div className={`${color} opacity-60`}>
          <Icon size={18} />
        </div>
        <div>
          <div className={`text-lg font-bold font-mono tabular-nums ${color}`}>
            {loading ? '—' : value}
          </div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function AnnouncementBanner({ text, type }: { text: string; type: 'info' | 'warning' | 'success' }) {
  const styles = {
    info: 'border-neon/30 bg-neon/5 text-neon',
    warning: 'border-draw/30 bg-draw/5 text-draw',
    success: 'border-win/30 bg-win/5 text-win',
  };

  return (
    <div className={`rounded-lg border px-4 py-2.5 text-sm ${styles[type]}`}>
      <Megaphone size={14} className="inline-block mr-2 -mt-0.5" />
      {text}
    </div>
  );
}

function ActivityFeedItem({ event }: { event: ActivityEvent }) {
  const { leagues } = useAppData();
  const Icon = EVENT_ICONS[event.type] || Settings;
  const league = event.leagueId ? leagues.find(l => l.id === event.leagueId) : null;

  const ts = new Date(event.timestamp);
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const timeStr = diffDays === 0
    ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : diffDays === 1 ? '1d ago'
    : `${diffDays}d ago`;

  return (
    <div className="flex items-start gap-2 px-4 py-2 hover:bg-surface-overlay/30 transition-colors">
      <Icon size={12} className="text-text-muted shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-text-secondary leading-tight">
          <span className="font-medium text-text-primary">{event.actor}</span>{' '}
          <span className="truncate">{event.description.toLowerCase()}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {league && (
            <span className="text-[9px] font-medium" style={{ color: league.color }}>
              {league.name.replace(' League', '')}
            </span>
          )}
          <span className="text-[9px] text-text-muted">{timeStr}</span>
        </div>
      </div>
    </div>
  );
}
