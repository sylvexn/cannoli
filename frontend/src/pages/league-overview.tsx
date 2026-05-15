import { useState, useEffect } from 'react';
import { formatRelativeTime } from '@/lib/format';
import { Link } from 'react-router-dom';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiTeam, ApiActivityEvent, ApiSiteSettings } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { EmptyState } from '@/components/empty-state';
import { CoachLink } from '@/components/coach-link';
import { EventDescription } from '@/components/event-description';
import { cn } from '@/lib/utils';
import { PHASE_COLORS } from '@/lib/constants';
import {
  Megaphone, Users, Swords, ArrowLeftRight, Trophy,
  ScrollText, Settings, Play, Check, Star, X,
} from 'lucide-react';

const EVENT_ICONS: Record<string, typeof Users> = {
  draft_started: Play, draft_pick: Trophy, draft_completed: Check,
  trade_proposed: ArrowLeftRight, trade_approved: Check, trade_rejected: X,
  match_reported: Swords, tera_captain_set: Star, tera_types_changed: Star,
  pin_awarded: Trophy,
};

/**
 * Map an event type to its category-color treatment for the activity feed.
 * Each category gets a distinct accent so the feed reads as a stream of
 * typed moments rather than a flat list of paragraphs.
 */
type EventTone = {
  /** CSS color value used for icon tint + left border */
  color: string;
  /** Tailwind class fragment for icon */
  iconClass: string;
};

const EVENT_TONES: Record<string, EventTone> = {
  draft:  { color: '#22d3ee', iconClass: 'text-neon' },           // cyan
  trade:  { color: '#e879f9', iconClass: 'text-pink' },           // pink secondary
  match:  { color: '#fbbf24', iconClass: 'text-amber-400' },      // amber
  fa:     { color: '#a78bfa', iconClass: 'text-violet-400' },     // violet (free-agent)
  team:   { color: '#94a3b8', iconClass: 'text-text-secondary' },
  admin:  { color: '#5c6070', iconClass: 'text-text-muted' },
  scrim:  { color: '#a78bfa', iconClass: 'text-violet-400' },
  pin:    { color: '#fbbf24', iconClass: 'text-amber-400' },
};

function getEventTone(event: ApiActivityEvent): EventTone {
  // Pin events use their own tone regardless of category
  if (event.type === 'pin_awarded' || event.type.startsWith('pin_')) {
    return EVENT_TONES.pin;
  }
  return EVENT_TONES[event.category] ?? EVENT_TONES.admin;
}

// League-relevant categories for the public feed
const FEED_CATEGORIES = new Set(['draft', 'trade', 'match', 'team']);

export function LeagueOverviewPage() {
  const { leagues, loading } = useAppData();
  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [tradesCount, setTradesCount] = useState<number>(0);
  const [tradesLoading, setTradesLoading] = useState(true);

  // Fetch teams for all leagues
  useEffect(() => {
    if (leagues.length === 0) return;
    setTeamsLoading(true);
    Promise.all(
      leagues.map(l =>
        api.getTeams(l.id)
          .then(teams => [l.id, teams] as const)
          // If a league's /teams endpoint 500s, fall back to an empty list so
          // one bad league doesn't blank the whole overview.
          .catch(() => [l.id, []] as const)
      )
    ).then(results => {
      setTeamsPerLeague(Object.fromEntries(results));
      setTeamsLoading(false);
    }).catch(() => setTeamsLoading(false));
  }, [leagues]);

  // Fetch trades for all leagues to compute the accepted count
  useEffect(() => {
    if (leagues.length === 0) return;
    setTradesLoading(true);
    Promise.all(
      leagues.map(l => api.getTrades(l.id).catch(() => []))
    ).then(results => {
      const accepted = results.flat().filter(t => t.status === 'accepted').length;
      setTradesCount(accepted);
      setTradesLoading(false);
    }).catch(() => setTradesLoading(false));
  }, [leagues]);

  // Compute site-wide stats from fetched teams. Guard against partial/missing
  // shapes — /teams can 500 or return malformed entries when the standings query
  // crashes, and we don't want to take down the whole page.
  const allTeams = Object.values(teamsPerLeague).flat();
  const totalPlayers = allTeams.length;
  const totalDrafted = allTeams.reduce((s, t) => s + (t?.roster?.length ?? 0), 0);
  const totalMatches = allTeams.reduce(
    (s, t) => s + (t?.record?.wins ?? 0) + (t?.record?.losses ?? 0),
    0,
  ) / 2;

  // Recent activity — league events only (draft, trade, match, team)
  const [recentActivity, setRecentActivity] = useState<ApiActivityEvent[]>([]);
  const [siteSettings, setSiteSettings] = useState<ApiSiteSettings | null>(null);

  useEffect(() => {
    api.getActivityLog({ limit: 20 })
      .then(({ events }) => {
        setRecentActivity(events
          .filter(e => FEED_CATEGORIES.has(e.category))
          .slice(0, 8)
        );
      })
      .catch(() => {});
    api.getSiteSettings()
      .then(setSiteSettings)
      .catch(() => {});
  }, []);

  const announcement = siteSettings?.announcement ? {
    enabled: true,
    text: siteSettings.announcement,
    type: (siteSettings.announcementType || 'info') as 'info' | 'warning' | 'success',
  } : { enabled: false, text: '', type: 'info' as const };

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
          <span className="text-neon">League</span>{' '}
          <span className="text-text-primary">Overview</span>
        </h1>
        <p className="text-sm text-text-muted">{leagues.length} active leagues</p>
      </div>

      {/* Announcement Banner */}
      {announcement.enabled && (
        <AnnouncementBanner text={announcement.text} type={announcement.type} />
      )}

      {/* Stats Row */}
      <div className="inline-flex flex-wrap items-stretch rounded-lg border border-border-default bg-surface-raised divide-x divide-border-subtle overflow-hidden">
        <StatCard icon={Users} label="Players" value={totalPlayers} color="text-neon" loading={teamsLoading} />
        <StatCard icon={Trophy} label="Pokemon Drafted" value={totalDrafted} color="text-draw" loading={teamsLoading} />
        <StatCard icon={ArrowLeftRight} label="Trades" value={tradesCount} color="text-purple-400" loading={tradesLoading} />
        <StatCard icon={Swords} label="Matches Played" value={Math.floor(totalMatches)} color="text-win" loading={teamsLoading} />
      </div>

      {/* Main content: League cards + Activity feed */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* League cards (3 cols on xl) */}
        <div className="xl:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {leagues.map((league, leagueIdx) => {
            const teams = teamsPerLeague[league.id] || [];
            // API already returns teams in the canonical standings order
            // (h2h → diff → kills → id). Don't re-sort.
            const standings = teams;

            return (
              <Card
                key={league.id}
                className="stagger-item card-interactive bg-surface-raised border-border-default overflow-hidden"
                style={{
                  ['--i' as never]: Math.min(leagueIdx, 20),
                  ['--card-accent' as never]: league.color,
                  ['--card-glow' as never]: `${league.color}30`,
                }}
              >
                <div className="h-1" style={{ backgroundColor: league.color }} />

                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <Link to={`/league/${league.id}`} viewTransition className="hover:opacity-80 transition-opacity">
                      <CardTitle className="text-base font-heading" style={{ color: league.color }}>
                        {league.name}
                      </CardTitle>
                    </Link>
                    <Badge variant="outline" className={cn('text-[10px]', PHASE_COLORS[league.season.phase])}>
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
                          to={`/league/${league.id}/teams/${team.id}`} viewTransition
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
                    <EmptyState
                      variant="coming-soon"
                      title="Coming soon."
                      spriteSize="md"
                      padding="sm"
                    />
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
                {recentActivity.length > 0 ? (
                  recentActivity.map((event, i) => {
                    const eventLeague = leagues.find(l => l.id === event.leagueId);
                    return (
                      <div
                        key={event.id}
                        className="stagger-item row-interactive"
                        style={{
                          ['--i' as never]: Math.min(i, 20),
                          ['--card-accent' as never]: eventLeague?.color ?? 'var(--color-neon)',
                        }}
                      >
                        <ActivityFeedItem event={event} teamsPerLeague={teamsPerLeague} />
                      </div>
                    );
                  })
                ) : (
                  <EmptyState
                    variant="quiet"
                    title="Quiet around here."
                    subtitle="No league activity yet."
                    spriteSize="md"
                    padding="sm"
                  />
                )}
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
    <div className="flex items-center gap-2.5 px-4 py-2 min-w-[140px]">
      <div className={`${color} opacity-60`}>
        <Icon size={16} />
      </div>
      <div className="leading-tight">
        <div className={`text-base font-bold font-mono tabular-nums ${color}`}>
          {loading ? '—' : value}
        </div>
        <div className="text-[10px] text-text-muted uppercase tracking-wide">{label}</div>
      </div>
    </div>
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

function ActivityFeedItem({
  event,
  teamsPerLeague,
}: {
  event: ApiActivityEvent;
  teamsPerLeague?: Record<string, ApiTeam[]>;
}) {
  const { leagues } = useAppData();
  const Icon = EVENT_ICONS[event.type] || Settings;
  const league = event.leagueId ? leagues.find(l => l.id === event.leagueId) : null;
  const tone = getEventTone(event);

  return (
    <div
      className="relative flex items-start gap-2 px-3 py-2 hover:bg-surface-overlay/30 transition-colors overflow-hidden border-l-2"
      style={{ borderLeftColor: `${tone.color}80` }}
    >
      <Icon size={12} className={cn('shrink-0 mt-1', tone.iconClass)} />
      <div className="flex-1 min-w-0 overflow-hidden flex items-start gap-2">
        <CoachLink
          coach={{ username: event.actor }}
          showAvatar
          avatarSize="lg"
          avatarOnly
          size="xs"
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
        <p className="text-[11px] text-text-secondary leading-tight">
          <CoachLink coach={{ username: event.actor }} size="xs" />
          {' '}
          <EventDescription event={event} teamsPerLeague={teamsPerLeague} />
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {league && (
            <span className="text-[9px] font-medium shrink-0" style={{ color: league.color }}>
              {league.name.replace(' League', '')}
            </span>
          )}
          <span className="text-[9px] text-text-muted shrink-0">
            {event.timestamp ? formatRelativeTime(event.timestamp) : ''}
          </span>
        </div>
        </div>
      </div>
    </div>
  );
}
