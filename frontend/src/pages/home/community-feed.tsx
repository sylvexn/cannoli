import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLink } from '@/components/team-link';
import { RecordDisplay } from '@/components/record-display';
import { EmptyState } from '@/components/empty-state';
import { ActivityFeed } from '@/components/activity-feed';
import { cn } from '@/lib/utils';
import { PHASE_COLORS } from '@/lib/constants';
import { Megaphone, Users, Swords, ArrowLeftRight, Trophy, ScrollText } from 'lucide-react';
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
  announcement,
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
  announcement: { enabled: boolean; text: string; type: 'info' | 'warning' | 'success' };
}) {
  return (
    <div className="space-y-6">
      {announcement.enabled && (
        <AnnouncementBanner text={announcement.text} type={announcement.type} />
      )}

      <HeadlinesStrip headlines={headlines} />

      {/* Center column (~720px) is the activity feed; right rail holds the
          condensed stats bar + per-league quick standings cards. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,720px)_280px] gap-6 items-start">
        <ActivityFeed activity={recentActivity} teamsPerLeague={teamsPerLeague} variant="dense" />

        <div className="space-y-4 xl:sticky xl:top-4">
          <div className="rounded-lg border border-border-default bg-surface-raised divide-y divide-border-subtle overflow-hidden">
            <StatRow icon={Users} label="Players" value={totalPlayers} color="text-neon" loading={teamsLoading} />
            <StatRow icon={Trophy} label="Drafted" value={totalDrafted} color="text-draw" loading={teamsLoading} />
            <StatRow icon={ArrowLeftRight} label="Trades" value={tradesCount} color="text-purple-400" loading={tradesLoading} />
            <StatRow icon={Swords} label="Matches" value={Math.floor(totalMatches)} color="text-win" loading={teamsLoading} />
          </div>

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

      {/* Secondary surface: dense league cards. Power users still get the
          full at-a-glance view, just collapsed below the fold. */}
      <details className="rounded-lg border border-border-default bg-surface-raised">
        <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-text-primary transition-colors flex items-center gap-2">
          <ScrollText size={12} />
          All standings (dense view)
        </summary>
        <div className="p-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
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
      </details>
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

function LeagueQuickCard({
  league, teams, loading,
}: {
  league: League;
  teams: ApiTeam[];
  loading: boolean;
}) {
  const top3 = teams.slice(0, 3);

  return (
    <Card
      className="bg-surface-raised border-border-default overflow-hidden"
      style={{
        background:
          `linear-gradient(160deg, ${league.color}10 0%, ${league.color}05 40%, transparent 100%),` +
          `var(--color-surface-raised)`,
      }}
    >
      <div className="h-0.5" style={{ backgroundColor: league.color }} />
      <CardHeader className="pb-1.5 pt-2.5 px-3">
        <div className="flex items-center justify-between gap-2">
          <Link to={`/league/${league.id}`} viewTransition className="hover:opacity-80 transition-opacity min-w-0">
            <CardTitle className="text-[13px] font-heading truncate" style={{ color: league.color }}>
              {league.name}
            </CardTitle>
          </Link>
          <Badge variant="outline" className={cn('text-[9px] shrink-0', PHASE_COLORS[league.season.phase])}>
            {league.season.phase}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-2.5 pt-0">
        {loading ? (
          <div className="text-center py-3 text-text-muted text-xs">…</div>
        ) : top3.length > 0 ? (
          <div className="space-y-0.5">
            {top3.map((team, i) => (
              <div
                key={team.id}
                className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-surface-overlay/60 transition-colors"
              >
                <span className="text-[10px] font-mono font-bold tabular-nums w-3.5 text-center text-neon">
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
          </div>
        ) : (
          <div className="text-center py-2 text-text-muted text-[11px]">No teams yet.</div>
        )}
      </CardContent>
    </Card>
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
          <EmptyState variant="coming-soon" title="Coming soon." spriteSize="md" padding="sm" />
        )}
      </CardContent>
    </Card>
  );
}

function AnnouncementBanner({ text, type }: { text: string; type: 'info' | 'warning' | 'success' }) {
  const tone =
    type === 'warning' ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-300' :
    type === 'success' ? 'bg-win/10 border-win/30 text-win' :
    'bg-neon/10 border-neon/30 text-neon';

  return (
    <div className={cn('flex items-start gap-2 px-4 py-2.5 rounded-lg border', tone)}>
      <Megaphone size={14} className="mt-0.5 shrink-0" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
