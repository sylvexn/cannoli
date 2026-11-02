import { Link } from 'react-router-dom';
import { LeagueStripe, leagueSubline } from '@/components/league-name';
import { TeamLink } from '@/components/team-link';
import { gemHex } from '@/lib/use-gem-scope';
import type { ApiTeam } from '@/lib/api';
import type { League } from '@/lib/types';

/** Lobby league card: stripe name, season line, top 3 teams. */
export function LeagueCard({ league, teams, loading }: { league: League; teams: ApiTeam[]; loading: boolean }) {
  const c = gemHex(league.id);
  const top = teams.slice(0, 3); // backend returns standings order
  return (
    <div
      className="grid content-start gap-2.5 rounded-md border border-border-subtle p-4 transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-border-default"
      style={{ background: `linear-gradient(160deg, color-mix(in oklab, ${c} 16%, var(--color-surface-raised)), var(--color-surface-raised) 60%)` }}
    >
      <Link to={`/league/${league.id}`} className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-gem/60">
        <LeagueStripe name={league.name} color={c} size={22} />
      </Link>
      <span className="text-xs text-text-muted">
        {leagueSubline(league.season)}{teams.length > 0 && ` · ${teams.length} teams`}
      </span>
      <div className="grid gap-1">
        {loading && top.length === 0 && <span className="text-xs text-text-muted">Loading…</span>}
        {top.map((t, i) => (
          <div key={t.id} className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="w-3 shrink-0 font-mono text-xs text-text-muted">{i + 1}</span>
            <TeamLink
              team={{ leagueId: league.id, teamId: t.id, teamName: t.teamName, teamAbbrev: t.teamAbbrev, teamColor: t.teamColor, logoPath: t.logoPath, record: t.record }}
              className="min-w-0 truncate font-semibold"
            >
              {t.teamName}
            </TeamLink>
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
              {t.record.wins}–{t.record.losses}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
