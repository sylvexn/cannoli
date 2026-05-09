import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type {
  ApiTeam, ApiTrade, ApiSchedule, ApiActivityEvent, ApiSiteSettings,
} from '@/lib/api';
import { deriveHeadlines } from './headlines';
import { HeaderGuest } from './header-guest';
import { HeaderMember } from './header-member';
import { HeaderCoach, type MyTeamEntry } from './header-coach';
import { HeaderAdmin } from './header-admin';
import { CommunityFeed } from './community-feed';

const FEED_CATEGORIES = new Set(['draft', 'trade', 'match', 'team']);

/**
 * Unified Home — replaces the old /me + / split with a single role-aware page
 * at the index route. Top half varies by audience (guest / member / coach,
 * with an admin strip layered on top); bottom half is the community feed
 * everyone sees identically.
 *
 * One pass of data fetching feeds every consumer:
 *   teamsPerLeague + tradesPerLeague are needed for both the personalized
 *   "my team" cards and the community-feed standings/stats. activity drives
 *   the feed and the headlines algorithm. schedulePerLeague only matters when
 *   we have at least one team — fetched conditionally below.
 */
export function HomePage() {
  const { user, isAdmin } = useAuth();
  const { leagues, loading: leaguesLoading } = useAppData();

  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [tradesPerLeague, setTradesPerLeague] = useState<Record<string, ApiTrade[]>>({});
  const [tradesLoading, setTradesLoading] = useState(true);
  const [schedulePerLeague, setSchedulePerLeague] = useState<Record<string, ApiSchedule>>({});
  const [activity, setActivity] = useState<ApiActivityEvent[]>([]);
  const [siteSettings, setSiteSettings] = useState<ApiSiteSettings | null>(null);

  useEffect(() => {
    if (leagues.length === 0) return;
    setTeamsLoading(true);
    Promise.all(
      leagues.map(l =>
        api.getTeams(l.id)
          .then(teams => [l.id, teams] as const)
          // One bad league shouldn't blank the whole home page.
          .catch(() => [l.id, []] as const)
      )
    ).then(results => {
      setTeamsPerLeague(Object.fromEntries(results));
      setTeamsLoading(false);
    }).catch(() => setTeamsLoading(false));
  }, [leagues]);

  useEffect(() => {
    if (leagues.length === 0) return;
    setTradesLoading(true);
    Promise.all(
      leagues.map(l => api.getTrades(l.id).then(t => [l.id, t] as const).catch(() => [l.id, [] as ApiTrade[]] as const))
    ).then(results => {
      setTradesPerLeague(Object.fromEntries(results));
      setTradesLoading(false);
    }).catch(() => setTradesLoading(false));
  }, [leagues]);

  useEffect(() => {
    api.getActivityLog({ limit: 40 })
      .then(({ events }) => {
        setActivity(events.filter(e => FEED_CATEGORIES.has(e.category)).slice(0, 24));
      })
      .catch(() => {});
    api.getSiteSettings().then(setSiteSettings).catch(() => {});
  }, []);

  // Schedule fetch — only for the coach view. Skipping for guests/members
  // saves N round-trips on the most common visit shape.
  const myTeams = useMemo<MyTeamEntry[]>(() => {
    if (!user) return [];
    const out: MyTeamEntry[] = [];
    for (const league of leagues) {
      const teams = teamsPerLeague[league.id] ?? [];
      const idx = teams.findIndex(t => t.userId != null && String(t.userId) === user.id);
      if (idx >= 0) {
        out.push({
          league,
          team: teams[idx],
          teams,
          schedule: schedulePerLeague[league.id] ?? { matches: [], byes: [] },
          rank: idx + 1, // backend already returns ordered by tiebreaker
          totalTeams: teams.length,
        });
      }
    }
    return out;
  }, [user, leagues, teamsPerLeague, schedulePerLeague]);

  useEffect(() => {
    // Only fetch schedules for leagues where the user has a team — the coach
    // header is the sole consumer.
    const leagueIdsToFetch = myTeams.map(t => t.league.id).filter(id => !(id in schedulePerLeague));
    if (leagueIdsToFetch.length === 0) return;
    Promise.all(
      leagueIdsToFetch.map(id =>
        api.getSchedule(id)
          .then(s => [id, s] as const)
          .catch(() => [id, { matches: [], byes: [] } as ApiSchedule] as const)
      )
    ).then(results => {
      setSchedulePerLeague(prev => ({ ...prev, ...Object.fromEntries(results) }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTeams.map(t => t.league.id).join(',')]);

  const pendingTradesForMe = useMemo(() => {
    const myTeamIds = new Set(myTeams.map(m => m.team.id));
    return Object.entries(tradesPerLeague).flatMap(([leagueId, trades]) =>
      trades
        .filter(t => myTeamIds.has(t.recipientId) && (t.status === 'pending' || t.status === 'awaiting_admin'))
        .map(t => ({ leagueId, trade: t })),
    );
  }, [tradesPerLeague, myTeams]);

  // Site-wide community-feed stats. Guarded against partial team shapes —
  // /teams can 500 in odd states and we don't want to crash the whole page.
  const allTeams = Object.values(teamsPerLeague).flat();
  const totalPlayers = allTeams.length;
  const totalDrafted = allTeams.reduce((s, t) => s + (t?.roster?.length ?? 0), 0);
  const totalMatches = allTeams.reduce(
    (s, t) => s + (t?.record?.wins ?? 0) + (t?.record?.losses ?? 0),
    0,
  ) / 2;
  const tradesCount = useMemo(
    () => Object.values(tradesPerLeague).flat().filter(t => t.status === 'accepted').length,
    [tradesPerLeague],
  );

  const headlines = useMemo(() => deriveHeadlines({
    leagues,
    teamsPerLeague,
    tradesPerLeague,
    activity,
  }), [leagues, teamsPerLeague, tradesPerLeague, activity]);

  const announcement = siteSettings?.announcement ? {
    enabled: true,
    text: siteSettings.announcement,
    type: (siteSettings.announcementType || 'info') as 'info' | 'warning' | 'success',
  } : { enabled: false, text: '', type: 'info' as const };

  if (leaguesLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted text-sm">
        Loading leagues...
      </div>
    );
  }

  // Pick the role-shape header. Admin strip is composed on top of any of these.
  const role: 'guest' | 'member' | 'coach' =
    !user ? 'guest' : myTeams.length > 0 ? 'coach' : 'member';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-neon">Clubhouse</span>{' '}
          <span className="text-text-primary">Home</span>
        </h1>
        <p className="text-sm text-text-muted">
          {role === 'coach'
            ? `Your teams and what's happening across ${leagues.length} active league${leagues.length === 1 ? '' : 's'}.`
            : `What everyone is up to across ${leagues.length} active league${leagues.length === 1 ? '' : 's'}.`}
        </p>
      </div>

      {user && isAdmin && <HeaderAdmin />}

      {role === 'guest' && <HeaderGuest leagues={leagues} />}
      {role === 'member' && user && <HeaderMember username={user.username} leagues={leagues} />}
      {role === 'coach' && (
        <HeaderCoach
          myTeams={myTeams}
          pendingTradesForMe={pendingTradesForMe}
          leagues={leagues}
        />
      )}

      <CommunityFeed
        leagues={leagues}
        teamsPerLeague={teamsPerLeague}
        teamsLoading={teamsLoading}
        recentActivity={activity}
        headlines={headlines}
        totalPlayers={totalPlayers}
        totalDrafted={totalDrafted}
        tradesCount={tradesCount}
        totalMatches={totalMatches}
        tradesLoading={tradesLoading}
        announcement={announcement}
      />
    </div>
  );
}
