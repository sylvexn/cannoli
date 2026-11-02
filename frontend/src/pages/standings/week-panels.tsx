import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { TeamLogo } from '@/components/team-logo';
import { SectionHeading } from '@/components/section-heading';
import { useAuth } from '@/lib/auth-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { cn } from '@/lib/utils';
import type { Match, Player } from '@/lib/types';

function TeamBit({ p, align, dim, strong }: { p: Player; align: 'left' | 'right'; dim?: boolean; strong?: boolean }) {
  const leagueUrl = useLeagueUrl();
  return (
    <Link
      to={leagueUrl(`/teams/${p.id}`)}
      title={p.teamName}
      className={cn('flex items-center gap-2 min-w-0 hover:underline', align === 'right' && 'flex-row-reverse', dim && 'opacity-50')}
    >
      <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} logoPath={p.logoPath} className="!w-6 !h-6 shrink-0" />
      <span className={cn('truncate text-sm text-text-primary', strong && 'font-semibold')}>{p.teamAbbrev}</span>
      <span className="hidden sm:inline font-mono text-[11px] text-text-muted tabular-nums shrink-0">
        {p.record.wins}–{p.record.losses}
      </span>
    </Link>
  );
}

const ROW = 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 h-[34px] px-2 rounded-md hover:bg-surface-overlay/40';

export function ThisWeek({ week, matches, byId, myTeamId }: {
  week: number; matches: Match[]; byId: Map<string, Player>; myTeamId: string | null;
}) {
  const leagueUrl = useLeagueUrl();
  return (
    <section>
      <SectionHeading meta={`${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`} action={<Link to={leagueUrl('/schedule')}>Schedule</Link>}>
        This week
      </SectionHeading>
      {matches.length === 0 && <p className="text-sm text-text-muted py-3">No matches scheduled for week {week}.</p>}
      {matches.map(m => {
        const h = byId.get(m.homePlayer);
        const a = byId.get(m.awayPlayer);
        if (!h || !a) return null;
        const mine = h.id === myTeamId || a.id === myTeamId;
        return (
          <div key={m.id} className={cn(ROW, mine && 'ring-1 ring-gem/50')}>
            <TeamBit p={h} align="left" />
            <span className="text-[11px] text-text-muted">vs</span>
            <TeamBit p={a} align="right" />
          </div>
        );
      })}
    </section>
  );
}

const played = (m: Match) => m.homeScore != null && m.awayScore != null;

export function LastWeek({ week, matches, byId, title = 'Last week', note }: {
  week: number; matches: Match[]; byId: Map<string, Player>; title?: string; note?: ReactNode;
}) {
  const { spoilerFreeMode, spoilerRevealedMatches, revealMatch } = useAuth();
  const leagueUrl = useLeagueUrl();
  const hidden = spoilerFreeMode && matches.some(m => played(m) && !spoilerRevealedMatches.includes(m.id));
  return (
    <section>
      <SectionHeading meta={`Week ${week}`} action={<Link to={leagueUrl('/schedule')}>Results</Link>}>
        {title}
      </SectionHeading>
      {note && <p className="text-sm text-text-secondary pb-1.5">{note}</p>}
      <div className="relative">
        <div
          className={cn('transition-[filter] duration-200', hidden && 'pointer-events-none select-none')}
          style={hidden ? { filter: 'blur(7px)' } : undefined}
          aria-hidden={hidden || undefined}
        >
          {matches.map(m => {
            const h = byId.get(m.homePlayer);
            const a = byId.get(m.awayPlayer);
            if (!h || !a) return null;
            const done = played(m);
            const hw = done && !hidden && m.homeScore! > m.awayScore!;
            const aw = done && !hidden && m.awayScore! > m.homeScore!;
            return (
              <div key={m.id} className={ROW}>
                <TeamBit p={h} align="left" dim={done && !hw} strong={hw} />
                {done ? (
                  <span className="font-mono text-sm tabular-nums">
                    <span className={hw ? 'text-text-primary font-semibold' : 'text-text-muted'}>{m.homeScore}</span>
                    <span className="text-text-muted mx-1">–</span>
                    <span className={aw ? 'text-text-primary font-semibold' : 'text-text-muted'}>{m.awayScore}</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-text-muted">vs</span>
                )}
                <TeamBit p={a} align="right" dim={done && !aw} strong={aw} />
              </div>
            );
          })}
        </div>
        {hidden && (
          <div className="absolute inset-0 grid place-items-center">
            <Button onClick={() => matches.forEach(m => revealMatch(m.id))}>Reveal week {week}</Button>
          </div>
        )}
      </div>
    </section>
  );
}
