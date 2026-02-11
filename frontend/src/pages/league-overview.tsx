import { Link } from 'react-router-dom';
import { leagues } from '@/mocks/leagues';
import { mockActivityLog } from '@/mocks/activity-log';
import { trades } from '@/mocks/trades';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { cn } from '@/lib/utils';
import type { ActivityEvent } from '@/lib/types';
import {
  Megaphone, Users, Swords, ArrowLeftRight, Trophy,
  ScrollText, UserPlus, ShieldCheck, LogIn, Play,
  Check, Star, Settings, Sparkles, X, KeyRound, UserX,
} from 'lucide-react';

const phaseColors: Record<string, string> = {
  draft: 'text-draw bg-draw/10',
  regular: 'text-neon bg-neon/10',
  playoffs: 'text-pink bg-pink/10',
  offseason: 'text-text-muted bg-surface-overlay',
};

// Reuse icon map from activity log
const EVENT_ICONS: Record<string, typeof Users> = {
  user_created: UserPlus, user_role_changed: ShieldCheck, user_deactivated: UserX,
  password_reset: KeyRound, password_changed: KeyRound, user_login: LogIn,
  league_config_updated: Settings, phase_advanced: Play, season_created: Sparkles,
  draft_started: Play, draft_pick: Trophy, draft_completed: Check,
  trade_proposed: ArrowLeftRight, trade_approved: Check, trade_rejected: X,
  match_reported: Swords, tera_captain_set: Star, tera_types_changed: Star,
};

export function LeagueOverviewPage() {
  // Compute site-wide stats
  const totalPlayers = leagues.reduce((sum, l) => sum + l.players.length, 0);
  const totalDrafted = leagues.reduce(
    (sum, l) => sum + l.players.reduce((s, p) => s + p.roster.length, 0), 0
  );
  const totalTrades = trades.filter(t => t.status === 'accepted').length;
  const totalMatches = leagues.reduce(
    (sum, l) => sum + l.players.reduce((s, p) => s + p.record.wins + p.record.losses, 0), 0
  ) / 2; // each match counted twice (once per player)

  // Recent activity (exclude auth events for the feed)
  const recentActivity = [...mockActivityLog]
    .filter(e => e.category !== 'auth')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);

  // Mock announcement (would come from site settings in real app)
  const announcement = {
    enabled: true,
    text: 'Trade deadline is Week 8 — get your offers in!',
    type: 'warning' as const,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-heading font-bold text-text-primary">League Overview</h1>
        <Badge variant="outline" className="border-neon/40 bg-surface-base text-neon font-mono text-xs px-2 py-0.5">
          S10
        </Badge>
        <Badge variant="outline" className="border-neon/40 bg-surface-base text-text-primary font-mono text-xs px-2 py-0.5">
          ALPHA
        </Badge>
      </div>

      {/* Announcement Banner */}
      {announcement.enabled && (
        <AnnouncementBanner text={announcement.text} type={announcement.type} />
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Players" value={totalPlayers} color="text-neon" />
        <StatCard icon={Trophy} label="Pokemon Drafted" value={totalDrafted} color="text-draw" />
        <StatCard icon={ArrowLeftRight} label="Trades" value={totalTrades} color="text-purple-400" />
        <StatCard icon={Swords} label="Matches Played" value={Math.floor(totalMatches)} color="text-win" />
      </div>

      {/* Main content: League cards + Activity feed */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* League cards (3 cols on xl) */}
        <div className="xl:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {leagues.map(league => {
            const standings = [...league.players].sort(
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
                  {league.hasData && standings.length > 0 ? (
                    <div className="space-y-1">
                      {standings.slice(0, 6).map((player, i) => (
                        <Link
                          key={player.id}
                          to={`/league/${league.id}/teams/${player.id}`}
                          className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-surface-overlay/60 transition-colors group"
                        >
                          <span className={cn(
                            'text-[10px] font-bold tabular-nums w-4 text-center',
                            i < 3 ? 'text-neon' : 'text-text-muted',
                          )}>
                            {i + 1}
                          </span>
                          <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
                          <span className="text-xs text-text-primary group-hover:text-neon transition-colors truncate flex-1">
                            {player.teamAbbrev}
                          </span>
                          <RecordDisplay
                            wins={player.record.wins}
                            losses={player.record.losses}
                            differential={player.record.differential}
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
              <Link
                to="/admin"
                className="block text-center text-[10px] text-text-muted hover:text-neon transition-colors py-2"
              >
                View all activity →
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: typeof Users;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="py-3 px-4 flex items-center gap-3">
        <div className={`${color} opacity-60`}>
          <Icon size={18} />
        </div>
        <div>
          <div className={`text-lg font-bold font-mono tabular-nums ${color}`}>{value}</div>
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
