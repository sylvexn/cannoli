import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLink } from '@/components/team-link';
import { RecordDisplay } from '@/components/record-display';
import { Spoiler } from '@/components/spoiler';
import { EmptyState } from '@/components/empty-state';
import { ActivityFeed } from '@/components/activity-feed';
import { cn } from '@/lib/utils';
import { PHASE_COLORS } from '@/lib/constants';
import { Users, Swords, ArrowLeftRight, Trophy } from 'lucide-react';
import type { ApiTeam, ApiActivityEvent } from '@/lib/api';
import type { League } from '@/lib/types';
import { HeadlinesStrip } from './headlines-strip';
import type { Headline } from './headlines';

/**
 * Community-feed body — the shared bottom half of the home page that every
 * audience sees identically. Sits below whichever role-conditional header
 * the orchestrator chose. Pure presentational; all data is passed in.
 *
 *   ┌──────────────────────────────────────┐
 *   │ announcement banner (optional)       │
 *   │ headlines strip                      │
 *   │ ┌──────────── grid ─────────────┐    │
 *   │ │ activity feed │ right rail    │    │
 *   │ │ (720 max)     │ (280: stats + │    │
 *   │ │               │  league quick │    │
 *   │ │               │  cards)       │    │
 *   │ └───────────────┴───────────────┘    │
 *   │ <details> all standings (dense)      │
 *   └──────────────────────────────────────┘
 */
export function CommunityFeed({
  leagues,
  teamsPerLeague,
  teamsLoading,
  recentActivity,
  headlines,
  totalPlayers,
  totalDrafted,
  tradesCount,
  totalMatches,
  tradesLoading,
}: {
  leagues: League[];
  teamsPerLeague: Record<string, ApiTeam[]>;
  teamsLoading: boolean;
  recentActivity: ApiActivityEvent[];
  headlines: Headline[];
  totalPlayers: number;
  totalDrafted: number;
  tradesCount: number;
  totalMatches: number;
  tradesLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <HeadlinesStrip headlines={headlines} />

      {/* Horizontal stats strip — was vertical inside the right rail; moved
          out so the activity column doesn't have to share height with it. */}
      <div className="rounded-lg border border-border-default bg-surface-raised grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border-subtle overflow-hidden">
        <StatRow icon={Users} label="Players" value={totalPlayers} color="text-neon" loading={teamsLoading} />
        <StatRow icon={Trophy} label="Drafted" value={totalDrafted} color="text-draw" loading={teamsLoading} />
        <StatRow icon={ArrowLeftRight} label="Trades" value={tradesCount} color="text-purple-400" loading={tradesLoading} />
        <StatRow icon={Swords} label="Matches" value={Math.floor(totalMatches)} color="text-win" loading={teamsLoading} />
      </div>

      {/* Two columns: dense league cards always-visible on the left (replaces
          the previous collapsed-by-default <details>); recent activity in a
          tall right rail. The dense cards are the real "what's the state of
          the leagues" surface — keeping them open by default trades collapse
          discipline for at-a-glance scanability. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {leagues.map((league, leagueIdx) => (
            <DenseLeagueCard
              key={league.id}
              league={league}
              teams={teamsPerLeague[league.id] ?? []}
              loading={teamsLoading}
              index={leagueIdx}
            />
          ))}
        </div>

        <ActivityFeed
          activity={recentActivity}
          teamsPerLeague={teamsPerLeague}
          variant="dense"
        />
      </div>
    </div>
  );
}

function StatRow({ icon: Icon, label, value, color, loading }: {
  icon: typeof Users;
  label: string;
  value: number;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon size={14} className={color} />
      <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">{label}</span>
      <span className={cn('ml-auto font-mono font-bold tabular-nums text-sm', color)}>
        {loading ? '…' : value.toLocaleString()}
      </span>
    </div>
  );
}

function DenseLeagueCard({
  league, teams, loading, index,
}: {
  league: League;
  teams: ApiTeam[];
  loading: boolean;
  index: number;
}) {
  // Spoiler-gate the dense records by the league's live week. When there's no
  // meaningful week yet (predraft / 0), render records untouched — there's
  // nothing to spoil. A real week routes through <Spoiler> so records are
  // blurred per-user by default and hard-locked when the admin gate trails it.
  const spoilerWeek = league.season.currentWeek > 0 ? league.season.currentWeek : undefined;
  return (
    <Card
      className="stagger-item card-interactive border-border-default overflow-hidden"
      style={{
        ['--i' as never]: Math.min(index, 20),
        ['--card-accent' as never]: league.color,
        ['--card-glow' as never]: `${league.color}30`,
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
        {loading ? (
          <div className="text-center py-6 text-text-muted text-sm">Loading...</div>
        ) : teams.length > 0 ? (
          <div className="space-y-1">
            {teams.slice(0, 6).map((team, i) => (
              <div
                key={team.id}
                className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-surface-overlay/60 transition-colors group"
                style={{ background: `linear-gradient(90deg, ${team.teamColor}10 0%, transparent 65%)` }}
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
                <Spoiler
                  week={spoilerWeek}
                  leagueId={league.id}
                  adminRevealedThrough={league.resultsRevealedThrough}
                  className="shrink-0"
                >
                  <RecordDisplay
                    wins={team.record.wins}
                    losses={team.record.losses}
                    differential={team.record.differential}
                    className="text-[10px]"
                  />
                </Spoiler>
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
          <EmptyState variant="coming-soon" title="Coming soon." spriteSize="md" padding="sm" />
        )}
      </CardContent>
    </Card>
  );
}

