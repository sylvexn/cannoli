import { useState, useEffect, useMemo } from 'react';
import { formatRelativeTime } from '@/lib/format';
import { Link } from 'react-router-dom';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiTeam, ApiActivityEvent, ApiSiteSettings, ApiTrade } from '@/lib/api';
import type { League } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLink } from '@/components/team-link';
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
import { deriveHeadlines } from './league-overview/headlines';
import { HeadlinesStrip } from './league-overview/headlines-strip';

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

  const [tradesPerLeague, setTradesPerLeague] = useState<Record<string, ApiTrade[]>>({});

  // Fetch trades for all leagues — used for both the stats counter and the
  // headlines-strip "biggest trade" derivation.
  useEffect(() => {
    if (leagues.length === 0) return;
    setTradesLoading(true);
    Promise.all(
      leagues.map(l => api.getTrades(l.id).then(t => [l.id, t] as const).catch(() => [l.id, [] as ApiTrade[]] as const))
    ).then(results => {
      const map = Object.fromEntries(results);
      setTradesPerLeague(map);
      const accepted = Object.values(map).flat().filter(t => t.status === 'accepted').length;
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
    // Pull a deeper slice (40) so the feed-first layout has room to breathe
    // and the headlines algorithm has enough signal to find an upset.
    api.getActivityLog({ limit: 40 })
      .then(({ events }) => {
        setRecentActivity(events
          .filter(e => FEED_CATEGORIES.has(e.category))
          .slice(0, 24)
        );
      })
      .catch(() => {});
    api.getSiteSettings()
      .then(setSiteSettings)
      .catch(() => {});
  }, []);

  // Auto-derived storylines: longest streak / recent upset / biggest trade.
  // Pure transform of the data already in scope — no additional fetch.
  const headlines = useMemo(() => deriveHeadlines({
    leagues,
    teamsPerLeague,
    tradesPerLeague,
    activity: recentActivity,
  }), [leagues, teamsPerLeague, tradesPerLeague, recentActivity]);

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
          <span className="text-neon">Clubhouse</span>{' '}
          <span className="text-text-primary">Home</span>
        </h1>
        <p className="text-sm text-text-muted">
          What everyone is up to across {leagues.length} active league{leagues.length === 1 ? '' : 's'}.
        </p>
      </div>

      {/* Announcement Banner */}
      {announcement.enabled && (
        <AnnouncementBanner text={announcement.text} type={announcement.type} />
      )}

      {/* Headlines strip — small auto-derived storylines */}
      <HeadlinesStrip headlines={headlines} />

      {/* ═══ FEED-FIRST GRID ═══
          Center column (~720px) is the activity feed; the right rail holds
          the condensed stats bar + per-league quick standings cards. The
          dense 3-column league cards become a *secondary* surface rendered
          below the main grid — still discoverable, but no longer the lead. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,720px)_280px] gap-6 items-start">
        <FeedColumn
          activity={recentActivity}
          teamsPerLeague={teamsPerLeague}
        />

        <div className="space-y-4 xl:sticky xl:top-4">
          {/* Compact stats bar — vertical on the right rail. */}
          <div className="rounded-lg border border-border-default bg-surface-raised divide-y divide-border-subtle overflow-hidden">
            <StatCard icon={Users} label="Players" value={totalPlayers} color="text-neon" loading={teamsLoading} block />
            <StatCard icon={Trophy} label="Drafted" value={totalDrafted} color="text-draw" loading={teamsLoading} block />
            <StatCard icon={ArrowLeftRight} label="Trades" value={tradesCount} color="text-purple-400" loading={tradesLoading} block />
            <StatCard icon={Swords} label="Matches" value={Math.floor(totalMatches)} color="text-win" loading={teamsLoading} block />
          </div>

          {/* League quick-cards — top 3 per league, links to full standings. */}
          <div className="space-y-3">
            {leagues.map(league => (
              <LeagueQuickCard
                key={league.id}
                league={league}
                teams={teamsPerLeague[league.id] ?? []}
                loading={teamsLoading}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Secondary surface: dense league cards (legacy view). Kept below the
          fold so power users can still scan all standings at once, but the
          page no longer leads with them. */}
      <details className="rounded-lg border border-border-default bg-surface-raised">
        <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-text-primary transition-colors flex items-center gap-2">
          <ScrollText size={12} />
          All standings (dense view)
        </summary>
        <div className="p-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {leagues.map((league, leagueIdx) => {
            const teams = teamsPerLeague[league.id] || [];
            // API already returns teams in the canonical standings order
            // (h2h → diff → kills → id). Don't re-sort.
            const standings = teams;

            return (
              <Card
                key={league.id}
                className="stagger-item card-interactive border-border-default overflow-hidden"
                style={{
                  ['--i' as never]: Math.min(leagueIdx, 20),
                  ['--card-accent' as never]: league.color,
                  ['--card-glow' as never]: `${league.color}30`,
                  // Ambient league-color bleed across the card surface.
                  background:
                    `linear-gradient(160deg, ${league.color}10 0%, ${league.color}05 40%, transparent 100%),` +
                    `var(--color-surface-raised)`,
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
                        <div
                          key={team.id}
                          className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-surface-overlay/60 transition-colors group"
                          style={{
                            background: `linear-gradient(90deg, ${team.teamColor}10 0%, transparent 65%)`,
                          }}
                        >
                          <span className={cn(
                            'text-[10px] font-bold tabular-nums w-4 text-center',
                            i < 3 ? 'text-neon' : 'text-text-muted',
                          )}>
                            {i + 1}
                          </span>
                          <TeamLink
                            team={{
                              leagueId: league.id,
                              teamId: team.id,
                              teamName: team.teamName,
                              teamAbbrev: team.teamAbbrev,
                              teamColor: team.teamColor,
                              logoPath: team.logoPath ?? null,
                              record: team.record,
                            }}
                            logoSize="sm"
                            size="xs"
                            className="flex-1 min-w-0"
                          />
                          <RecordDisplay
                            wins={team.record.wins}
                            losses={team.record.losses}
                            differential={team.record.differential}
                            className="text-[10px]"
                          />
                        </div>
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
      </details>
    </div>
  );
}

// ─── Feed column (primary) ───────────────────────────────────────────────
//
// Bigger avatars, narrative event text, more vertical breathing room than
// the old sidebar version. Space Grotesk for descriptions, mono for entity
// tags / counts. Renders inside a single Card so the whole column reads as
// a stream rather than a stack of segmented widgets.
function FeedColumn({
  activity,
  teamsPerLeague,
}: {
  activity: ApiActivityEvent[];
  teamsPerLeague: Record<string, ApiTeam[]>;
}) {
  const { leagues } = useAppData();
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2 border-b border-border-subtle">
        <CardTitle className="text-sm font-heading flex items-center gap-2">
          <ScrollText size={14} className="text-text-muted" />
          Recent Activity
          {activity.length > 0 && (
            <span className="text-[10px] font-mono text-text-muted/70 tabular-nums ml-1">
              {activity.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border-subtle/40">
          {activity.length > 0 ? (
            activity.map((event, i) => {
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
  );
}

// ─── League quick card (right rail) ──────────────────────────────────────
//
// Top-3 mini standings per league; clicks deep into the league page. Tighter
// than the legacy 6-row card (which now lives in the collapsed dense view).
function LeagueQuickCard({
  league, teams, loading,
}: {
  league: League;
  teams: ApiTeam[];
  loading: boolean;
}) {
  const standings = teams.slice(0, 3);
  return (
    <div
      className="rounded-lg border border-border-default bg-surface-raised overflow-hidden"
      style={{ ['--card-accent' as never]: league.color }}
    >
      <Link
        to={`/league/${league.id}`}
        viewTransition
        className="block px-3 py-2 hover:bg-surface-overlay/30 transition-colors group border-b border-border-subtle/40"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
            <span
              className="text-sm font-heading font-semibold truncate group-hover:text-neon transition-colors"
              style={{ color: league.color }}
            >
              {league.name.replace(' League', '')}
            </span>
          </div>
          <Badge variant="outline" className={cn('text-[9px]', PHASE_COLORS[league.season.phase])}>
            {league.season.phase}
          </Badge>
        </div>
      </Link>
      <div className="px-2 py-2">
        {loading ? (
          <div className="text-center py-2 text-text-muted text-xs">…</div>
        ) : standings.length > 0 ? (
          standings.map((t, i) => (
            <Link
              key={t.id}
              to={`/league/${league.id}/teams/${t.id}`}
              viewTransition
              className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-surface-overlay/40 transition-colors"
            >
              <span className={cn(
                'text-[10px] font-bold tabular-nums w-3 text-center',
                i === 0 ? 'text-amber-400' : 'text-text-muted',
              )}>
                {i + 1}
              </span>
              <span className="text-xs text-text-primary truncate flex-1">{t.teamAbbrev}</span>
              <RecordDisplay
                wins={t.record.wins}
                losses={t.record.losses}
                differential={t.record.differential}
                className="text-[10px]"
              />
            </Link>
          ))
        ) : (
          <p className="text-[11px] font-mono italic text-text-muted px-1.5 py-1">
            no standings yet
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, loading, block }: {
  icon: typeof Users;
  label: string;
  value: number;
  color: string;
  loading: boolean;
  /** When true, render as a stacked horizontal-fill row (used in the right-
   *  rail vertical stat bar). Default false = inline pill. */
  block?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-center gap-2.5',
      block ? 'px-3 py-2 w-full' : 'px-4 py-2 min-w-[140px]',
    )}>
      <div className={`${color} opacity-60`}>
        <Icon size={16} />
      </div>
      <div className="leading-tight flex-1">
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
      className="relative flex items-start gap-3 px-4 py-3 hover:bg-surface-overlay/30 transition-colors overflow-hidden border-l-2"
      style={{ borderLeftColor: `${tone.color}80` }}
    >
      {/* Larger avatar — feed-first layout has room to breathe. */}
      <CoachLink
        coach={{ username: event.actor }}
        showAvatar
        avatarSize="lg"
        avatarOnly
        size="xs"
        className="shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0 overflow-hidden">
        {/* Narrative line — Space Grotesk for the warmer read; entity tags
            inside <EventDescription> are already mono-styled. */}
        <div className="text-[13px] font-heading text-text-secondary leading-snug">
          <CoachLink coach={{ username: event.actor }} size="sm" />
          {' '}
          <EventDescription event={event} teamsPerLeague={teamsPerLeague} />
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <Icon size={11} className={cn('shrink-0', tone.iconClass)} />
          {league && (
            <span className="text-[10px] font-medium shrink-0" style={{ color: league.color }}>
              {league.name.replace(' League', '')}
            </span>
          )}
          <span className="text-[10px] font-mono text-text-muted shrink-0 tabular-nums">
            {event.timestamp ? formatRelativeTime(event.timestamp) : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
