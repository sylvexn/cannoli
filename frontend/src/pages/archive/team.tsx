import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import { cn } from '@/lib/utils';

/**
 * Team-season report page at /archive/:seasonId/:leagueId/:teamId.
 * Step 5 ships a minimal data dump; step 9 fills in the rich
 * week-by-week + transaction ledger + per-Pokemon stat layout.
 */

interface TeamSeason {
  team: { id: string; coachName: string; teamName: string; teamAbbrev: string; teamColor: string; userId: number | null };
  league: { id: string; name: string; color: string; seasonNumber: number | null } | null;
  roster: {
    name: string;
    nickname: string | null;
    tier: number;
    isTeraCaptain: boolean;
    isShiny: boolean;
    acquiredVia: string;
    acquiredWeek: number | null;
  }[];
  weekByWeek: {
    week: number;
    phase: string;
    opponentId: string;
    myScore: number | null;
    oppScore: number | null;
    result: 'W' | 'L' | 'T' | null;
  }[];
  transactions: any[];
  pokemonStats: { pokemonName: string; kills: number; deaths: number; gp: number }[];
  otherTeams: { id: string; coachName: string; teamName: string; teamAbbrev: string; teamColor: string }[];
}

export function ArchiveTeamPage() {
  const { seasonId, leagueId, teamId } = useParams<{ seasonId: string; leagueId: string; teamId: string }>();
  const [data, setData] = useState<TeamSeason | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId || !teamId) return;
    setLoading(true);
    fetch(`/api/archive/leagues/${leagueId}/teams/${teamId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [leagueId, teamId]);

  if (loading) return <div className="text-text-muted py-20 text-center text-sm">Loading team…</div>;
  if (!data || !('team' in data)) return <div className="text-text-muted py-20 text-center">Team not found.</div>;

  const { team, league, roster, weekByWeek, transactions, pokemonStats, otherTeams } = data;
  const otherById = new Map(otherTeams.map(t => [t.id, t]));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="lg" />
        <div className="flex-1">
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span style={{ color: team.teamColor }}>{team.teamAbbrev}</span>{' '}
            <span className="text-text-primary">{team.teamName}</span>
          </h1>
          <p className="text-sm text-text-muted">
            {team.userId ? (
              <Link to={`/coach/${team.coachName.toLowerCase().replace(/\s+/g, '')}`} className="hover:underline">
                {team.coachName}
              </Link>
            ) : team.coachName}
            {league && ` · ${league.name} · S${league.seasonNumber}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Roster */}
        <Card className="bg-surface-raised border-border-default lg:col-span-1">
          <CardContent className="p-4 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Roster ({roster.length})
            </div>
            {roster.sort((a, b) => b.tier - a.tier).map(mon => (
              <div key={mon.name} className="flex items-center gap-2 text-xs">
                <PokemonSprite name={mon.name} size="xs" />
                <Link to={pokemonRoute(mon.name)} className="flex-1 truncate hover:text-neon">
                  {mon.nickname ? (
                    <>
                      <span className="text-text-primary">{mon.nickname}</span>
                      <span className="text-text-muted"> ({mon.name})</span>
                    </>
                  ) : (
                    <span className="text-text-primary">{mon.name}</span>
                  )}
                </Link>
                <span className="font-mono text-text-muted">{mon.tier}</span>
                {mon.isTeraCaptain && <Badge variant="outline" className="text-[8px] border-purple-400 text-purple-400">T</Badge>}
                <Badge variant="outline" className="text-[8px] uppercase tracking-wider border-border-default text-text-muted">
                  {mon.acquiredVia}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Week by week */}
        <Card className="bg-surface-raised border-border-default lg:col-span-2">
          <CardContent className="p-4 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Week-by-week
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {weekByWeek.map(m => {
                const opp = otherById.get(m.opponentId);
                return (
                  <div
                    key={`${m.week}-${m.opponentId}`}
                    className={cn(
                      'rounded border px-2 py-1.5 text-[11px]',
                      m.result === 'W' ? 'border-win/40 bg-win/5'
                      : m.result === 'L' ? 'border-loss/40 bg-loss/5'
                      : m.result === 'T' ? 'border-draw/40 bg-draw/5'
                      : 'border-border-subtle',
                    )}
                  >
                    <div className="text-[9px] font-mono uppercase text-text-muted">
                      {m.phase === 'playoffs' ? `PO ${m.week}` : `Wk ${m.week}`}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {opp && <TeamLogo abbrev={opp.teamAbbrev} color={opp.teamColor} size="sm" />}
                      <span className="text-text-primary truncate">{opp?.teamAbbrev ?? '???'}</span>
                      <span className={cn(
                        'ml-auto font-mono font-bold',
                        m.result === 'W' ? 'text-win' : m.result === 'L' ? 'text-loss' : 'text-text-muted',
                      )}>
                        {m.myScore ?? '-'}–{m.oppScore ?? '-'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-surface-raised border-border-default">
          <CardContent className="p-4 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Per-Pokemon ({pokemonStats.length})
            </div>
            {pokemonStats.map(s => (
              <div key={s.pokemonName} className="flex items-center gap-2 text-xs">
                <PokemonSprite name={s.pokemonName} size="xs" />
                <span className="flex-1 truncate text-text-primary">{s.pokemonName}</span>
                <span className="font-mono text-text-muted">{s.kills}K/{s.deaths}D · {s.gp}gp</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-surface-raised border-border-default">
          <CardContent className="p-4 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Transactions ({transactions.length})
            </div>
            {transactions.length === 0 && (
              <div className="text-xs text-text-muted italic">No transactions this season.</div>
            )}
            {transactions.slice(0, 8).map((t, i) => (
              <div key={i} className="text-[11px] flex items-center gap-2">
                <span className="font-mono text-text-muted">W{t.week}</span>
                <Badge variant="outline" className="text-[8px] uppercase border-border-default text-text-muted">
                  {t.type}
                </Badge>
                {t.pokemonOut && <span className="text-loss">-{t.pokemonOut}</span>}
                {t.pokemonIn && <span className="text-win">+{t.pokemonIn}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
