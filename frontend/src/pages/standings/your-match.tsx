import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { TeamLogo } from '@/components/team-logo';
import { useLeague } from '@/lib/league-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { slabColor } from '@/lib/color';
import { cn } from '@/lib/utils';
import { formatDeadline, useUserTimezone } from '@/lib/format';
import { weekDueInstant } from './week-due';
import type { Player } from '@/lib/types';

function Side({ team, rank, align }: { team: Player; rank: number; align: 'left' | 'right' }) {
  const leagueUrl = useLeagueUrl();
  const c = slabColor(team.teamColor);
  return (
    <div
      className={cn('flex items-center gap-3 min-w-0 p-3', align === 'right' && 'flex-row-reverse text-right')}
      style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${c} 45%, transparent), transparent)` }}
    >
      <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} logoPath={team.logoPath} className="!w-[52px] !h-[52px] shrink-0" />
      <div className="min-w-0">
        <Link to={leagueUrl(`/teams/${team.id}`)} className="block truncate font-display text-lg leading-tight text-text-primary hover:underline">
          {team.teamName}
        </Link>
        <div className="font-mono text-xs text-text-secondary tabular-nums">
          {team.record.wins}–{team.record.losses} · #{rank}
        </div>
      </div>
    </div>
  );
}

export function YourMatch({ me, opp, week, rank }: { me: Player; opp: Player; week: number; rank: (id: string) => number }) {
  const league = useLeague();
  const leagueUrl = useLeagueUrl();
  const tz = useUserTimezone();
  const due = weekDueInstant(league, week);
  return (
    <section aria-label="Your match">
      <div className="rounded-md border border-border-subtle bg-surface-raised overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch">
          <Side team={me} rank={rank(me.id)} align="left" />
          <div className="flex flex-col items-center justify-center px-3 text-center">
            <span className="font-display text-xl text-text-muted">VS</span>
            <span className="text-xs text-text-secondary">Week {week}</span>
            {due && <span className="text-[11px] text-text-muted hidden sm:block">{formatDeadline(due, tz)}</span>}
          </div>
          <Side team={opp} rank={rank(opp.id)} align="right" />
        </div>
        <div className="flex items-center gap-2 flex-wrap border-t border-border-subtle px-3 py-2">
          <Button
            nativeButton={false}
            render={<Link to={`/matchup?leagueId=${league.id}&teamA=${me.id}&teamB=${opp.id}`} />}
          >
            Open Matchup Center
          </Button>
          <Link to={leagueUrl(`/teams/${me.id}`)} className="text-xs text-text-muted hover:text-text-primary px-2 py-1.5">
            Full team page
          </Link>
        </div>
      </div>
    </section>
  );
}
