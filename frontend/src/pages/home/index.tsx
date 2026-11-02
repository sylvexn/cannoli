import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Swords, ClipboardList, ListTree, Gamepad2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api, type ApiTeam, type ApiActivityEvent } from '@/lib/api';
import { LeagueProvider } from '@/lib/league-context';
import { LeagueDataProvider } from '@/lib/league-data-context';
import { SectionHeading } from '@/components/section-heading';
import { ActivityFeed } from '@/components/activity-feed';
import { SpoilerToggle } from '@/components/spoiler-toggle';
import { LoadingSprite } from '@/components/loading-sprite';
import { HeaderAdmin } from './header-admin';
import { HomeMatch } from './home-match';
import { LeagueCard } from './league-card';

const FEED_CATEGORIES = new Set(['draft', 'trade', 'match', 'team']);

const TOOLS = [
  { to: '/matchup', label: 'Matchup Center', icon: Swords },
  { to: '/draft-center', label: 'Draft Center', icon: ClipboardList },
  { to: '/tiers', label: 'Pokédex', icon: ListTree },
  { to: '/showdown', label: 'Play & Watch', icon: Gamepad2 },
];

/** Home = Lobby: your match + tools, the three leagues, then activity across them. */
export function HomePage() {
  const { user, isAdmin, isAuthenticated } = useAuth();
  const { leagues, loading: leaguesLoading } = useAppData();
  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [activity, setActivity] = useState<ApiActivityEvent[]>([]);

  useEffect(() => {
    if (leagues.length === 0) return;
    setTeamsLoading(true);
    Promise.all(leagues.map(l =>
      api.getTeams(l.id).then(t => [l.id, t] as const).catch(() => [l.id, [] as ApiTeam[]] as const),
    )).then(r => setTeamsPerLeague(Object.fromEntries(r))).finally(() => setTeamsLoading(false));
  }, [leagues]);

  useEffect(() => {
    api.getActivityLog({ limit: 40 })
      .then(({ events }) => setActivity(events.filter(e => FEED_CATEGORIES.has(e.category)).slice(0, 16)))
      .catch(() => {});
  }, []);

  const myLeague = useMemo(() => user
    ? leagues.find(l => (teamsPerLeague[l.id] ?? []).some(t => t.userId != null && String(t.userId) === user.id))
    : undefined, [user, leagues, teamsPerLeague]);

  if (leaguesLoading) return <LoadingSprite label="Loading leagues" padding="lg" />;

  const tools = (
    <div className="grid grid-cols-2 gap-2">
      {TOOLS.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex items-center gap-2.5 rounded-md border border-border-subtle bg-surface-raised px-3 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:border-gem/50 hover:bg-surface-overlay/60"
        >
          <Icon size={16} className="shrink-0 text-gem-ink" />
          {label}
        </Link>
      ))}
    </div>
  );

  return (
    <div className="space-y-7 pb-8">
      <h1 className="sr-only">Home</h1>
      {user && isAdmin && <HeaderAdmin />}

      {myLeague ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section>
            <LeagueProvider league={myLeague}>
              <LeagueDataProvider leagueId={myLeague.id}>
                <HomeMatch />
              </LeagueDataProvider>
            </LeagueProvider>
          </section>
          <section>
            <SectionHeading>Tools</SectionHeading>
            {tools}
          </section>
        </div>
      ) : (
        <section>
          <SectionHeading>Tools</SectionHeading>
          <div className="max-w-2xl">{tools}</div>
        </section>
      )}

      <section>
        <SectionHeading>Leagues</SectionHeading>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {leagues.map(l => (
            <LeagueCard key={l.id} league={l} teams={teamsPerLeague[l.id] ?? []} loading={teamsLoading} />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading action={isAuthenticated ? <SpoilerToggle /> : undefined}>Around the leagues</SectionHeading>
        <ActivityFeed activity={activity} teamsPerLeague={teamsPerLeague} variant="dense" bare />
      </section>
    </div>
  );
}
