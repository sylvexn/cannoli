import { Link } from 'react-router-dom';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { TeamLogo } from '@/components/team-logo';
import { CoachLink } from '@/components/coach-link';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { LoadingSprite } from '@/components/loading-sprite';
import { teamTintStyle } from '@/lib/color';
import { pokemonRoute } from '@/lib/pokemon-route';

/** League Teams: every team as a card (standings order), roster sprites inline. */
export function TeamsIndexPage() {
  const { standings, players, loading } = useLeagueData();
  const leagueUrl = useLeagueUrl();
  const teams = standings.length ? standings : players;

  if (loading && teams.length === 0) return <LoadingSprite label="Loading teams" />;

  return (
    <div className="h-full overflow-y-auto pb-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((t, i) => (
          <article
            key={t.id}
            className="group relative flex flex-col gap-2.5 rounded-md border border-border-subtle p-3 transition-colors hover:border-border-default"
            style={teamTintStyle(t.teamColor, 22)}
          >
            <div className="flex min-w-0 items-center gap-3">
              <TeamLogo abbrev={t.teamAbbrev} color={t.teamColor} logoPath={t.logoPath} className="!h-11 !w-11 shrink-0" />
              <div className="min-w-0 flex-1">
                <Link
                  to={leagueUrl(`/teams/${t.id}`)}
                  className="block truncate font-display text-lg leading-tight text-text-primary hover:underline"
                >
                  {t.teamName}
                </Link>
                <div className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
                  {t.owner ? <CoachLink coach={t.owner} size="xs" /> : <span>No coach</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm tabular-nums text-text-primary">{t.record.wins}–{t.record.losses}</div>
                {standings.length > 0 && <div className="text-[11px] text-text-muted">#{i + 1}</div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-0.5">
              {t.roster.map(m => (
                <Link key={m.name} to={pokemonRoute(m.name)} title={m.name} className="transition-transform hover:-translate-y-0.5">
                  <PokemonSprite name={m.name} size="xs" />
                </Link>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
