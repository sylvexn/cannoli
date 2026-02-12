import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { RecordDisplay } from '@/components/record-display';
import { cn } from '@/lib/utils';
import {
  Trophy, Crown, ChevronDown, Medal,
} from 'lucide-react';

interface ArchiveSeason {
  id: number;
  seasonNumber: number;
  phase: string;
}

interface ArchiveTeam {
  id: string;
  coachName: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  rank: number;
  record: { wins: number; losses: number; differential: number };
}

interface ArchivePlayoffMatch {
  id: string;
  playoffRound: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  homeSeed: number | null;
  awaySeed: number | null;
}

interface ArchiveMvp {
  pokemonName: string;
  teamId: string;
  kills: number;
  deaths: number;
  gp: number;
}

interface ArchiveLeague {
  id: string;
  name: string;
  color: string;
  teams: ArchiveTeam[];
  playoffs: ArchivePlayoffMatch[];
  champion: string | null;
  mvps: ArchiveMvp[];
}

export function ArchivePage() {
  const [seasons, setSeasons] = useState<ArchiveSeason[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [leagues, setLeagues] = useState<ArchiveLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaguesLoading, setLeaguesLoading] = useState(false);

  // Fetch seasons list
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/seasons`)
      .then(r => r.json())
      .then((data: ArchiveSeason[]) => {
        setSeasons(data);
        // Auto-select oldest completed season (not the current one)
        const archived = data.filter(s => s.phase === 'offseason');
        if (archived.length > 0) {
          setSelectedSeason(archived[0].id);
        } else if (data.length > 1) {
          setSelectedSeason(data[1].id);
        }
        setLoading(false);
      });
  }, []);

  // Fetch leagues for selected season
  useEffect(() => {
    if (!selectedSeason) return;
    setLeaguesLoading(true);
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/seasons/${selectedSeason}/leagues`)
      .then(r => r.json())
      .then((data: ArchiveLeague[]) => {
        setLeagues(data);
        setLeaguesLoading(false);
      });
  }, [selectedSeason]);

  if (loading) return <div className="text-text-muted py-20 text-center">Loading archive...</div>;

  const currentSeason = seasons.find(s => s.id === selectedSeason);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span className="text-purple-400">Season</span>
            <span className="text-text-primary ml-1">Archive</span>
          </h1>
          <p className="text-sm text-text-muted">Historical seasons and results</p>
        </div>

        {/* Season picker */}
        <div className="flex gap-2">
          {seasons.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedSeason(s.id)}
              className={cn(
                'px-4 py-2 rounded-lg border text-sm font-mono font-bold transition-all',
                selectedSeason === s.id
                  ? 'bg-purple-400/10 border-purple-400/40 text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                  : 'border-border-default text-text-muted hover:text-text-primary hover:border-border-default/80',
              )}
            >
              S{s.seasonNumber}
            </button>
          ))}
        </div>
      </div>

      {/* Season info bar */}
      {currentSeason && (
        <div className="flex items-center gap-4 text-sm text-text-muted">
          <span>Season {currentSeason.seasonNumber}</span>
          <span>·</span>
          <span>{leagues.length} leagues</span>
          <span>·</span>
          <span>{leagues.reduce((s, l) => s + l.teams.length, 0)} teams</span>
          {currentSeason.phase === 'offseason' && (
            <>
              <span>·</span>
              <Badge variant="outline" className="text-[10px] text-text-muted border-border-default">
                Completed
              </Badge>
            </>
          )}
        </div>
      )}

      {leaguesLoading ? (
        <div className="text-text-muted py-12 text-center">Loading season data...</div>
      ) : (
        <div className="space-y-8">
          {leagues.map(league => (
            <LeagueArchiveCard key={league.id} league={league} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeagueArchiveCard({ league }: { league: ArchiveLeague }) {
  const [expanded, setExpanded] = useState(false);
  const teamMap = useMemo(() => new Map(league.teams.map(t => [t.id, t])), [league.teams]);
  const champion = league.champion ? teamMap.get(league.champion) : null;

  // Find champion from playoffs if not set
  const derivedChampion = useMemo(() => {
    if (champion) return champion;
    // Last playoff winner
    const sorted = [...league.playoffs].reverse();
    for (const m of sorted) {
      if (m.homeScore != null && m.awayScore != null) {
        const winnerId = m.homeScore > m.awayScore ? m.homeTeamId : m.awayTeamId;
        return teamMap.get(winnerId) || null;
      }
    }
    return null;
  }, [champion, league.playoffs, teamMap]);

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      {/* League color bar */}
      <div className="h-1.5" style={{ backgroundColor: league.color }} />

      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg font-heading" style={{ color: league.color }}>
              {league.name}
            </CardTitle>
            <Badge variant="outline" className="text-[10px] text-text-muted">
              {league.teams.length} teams
            </Badge>
          </div>

          {/* Champion display */}
          {derivedChampion && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-draw/5 border border-draw/20">
              <Crown size={14} className="text-draw" />
              <TeamLogo abbrev={derivedChampion.teamAbbrev} color={derivedChampion.teamColor} size="sm" />
              <span className="text-sm font-bold text-draw">{derivedChampion.teamName}</span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Top 6 standings */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {league.teams.slice(0, 6).map((team, i) => (
            <div
              key={team.id}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors',
                i < 3 ? 'bg-surface-overlay/30' : '',
              )}
            >
              <span className={cn(
                'text-xs font-bold font-mono w-5 text-center',
                i === 0 ? 'text-draw' : i < 3 ? 'text-neon' : 'text-text-muted',
              )}>
                {i + 1}
              </span>
              <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-text-primary truncate block">
                  {team.teamName}
                </span>
                <span className="text-[10px] text-text-muted">{team.coachName}</span>
              </div>
              <RecordDisplay
                wins={team.record.wins}
                losses={team.record.losses}
                differential={team.record.differential}
                className="text-[10px]"
              />
            </div>
          ))}
        </div>

        {/* MVPs */}
        {league.mvps.length > 0 && (
          <div className="flex items-center gap-4 pt-2 border-t border-border-subtle">
            <div className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider shrink-0">
              <Medal size={12} />
              Season MVPs
            </div>
            <div className="flex gap-3">
              {league.mvps.map((mvp, i) => {
                const team = teamMap.get(mvp.teamId);
                return (
                  <div key={mvp.pokemonName} className="flex items-center gap-1.5">
                    <span className={cn(
                      'text-[10px] font-bold',
                      i === 0 ? 'text-draw' : i === 1 ? 'text-text-secondary' : 'text-[#cd7f32]',
                    )}>
                      #{i + 1}
                    </span>
                    <PokemonSprite name={mvp.pokemonName} size="xs" />
                    <span className="text-xs text-text-primary">{mvp.pokemonName}</span>
                    <span className="text-[10px] text-text-muted font-mono">
                      {mvp.kills}K/{mvp.deaths}D
                    </span>
                    {team && (
                      <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Expandable: full standings + bracket */}
        {league.teams.length > 6 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors w-full justify-center pt-1"
          >
            <ChevronDown size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'Show less' : `Show all ${league.teams.length} teams`}
          </button>
        )}

        {expanded && (
          <div className="space-y-4 pt-2 border-t border-border-subtle">
            {/* Remaining standings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {league.teams.slice(6).map((team, i) => (
                <div key={team.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-md">
                  <span className="text-xs font-bold font-mono w-5 text-center text-text-muted">
                    {i + 7}
                  </span>
                  <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
                  <span className="text-xs text-text-secondary flex-1 truncate">{team.teamName}</span>
                  <RecordDisplay
                    wins={team.record.wins}
                    losses={team.record.losses}
                    differential={team.record.differential}
                    className="text-[10px]"
                  />
                </div>
              ))}
            </div>

            {/* Playoff bracket mini */}
            {league.playoffs.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider mb-2">
                  <Trophy size={12} />
                  Playoff Bracket
                </div>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {(['qf', 'sf', 'f'] as const).map(round => {
                    const roundMatches = league.playoffs.filter(m => m.playoffRound === round);
                    if (roundMatches.length === 0) return null;
                    return (
                      <div key={round} className="min-w-[180px] space-y-2">
                        <div className="text-[9px] font-mono uppercase text-text-muted text-center">
                          {round === 'qf' ? 'Quarters' : round === 'sf' ? 'Semis' : 'Finals'}
                        </div>
                        {roundMatches.map(m => {
                          const home = teamMap.get(m.homeTeamId);
                          const away = teamMap.get(m.awayTeamId);
                          const hasResult = m.homeScore != null;
                          const homeWon = hasResult && m.homeScore! > m.awayScore!;
                          const awayWon = hasResult && m.awayScore! > m.homeScore!;

                          return (
                            <div key={m.id} className="rounded border border-border-subtle overflow-hidden text-[11px]">
                              <div className={cn('flex items-center gap-1.5 px-2 py-1', homeWon && 'bg-win/5')}>
                                <span className="text-[9px] font-mono text-text-muted w-3">{m.homeSeed}</span>
                                {home && <TeamLogo abbrev={home.teamAbbrev} color={home.teamColor} size="sm" />}
                                <span className={cn('flex-1 truncate', homeWon ? 'text-win font-medium' : awayWon ? 'text-text-muted' : 'text-text-primary')}>
                                  {home?.teamAbbrev || 'TBD'}
                                </span>
                                {hasResult && <span className={cn('font-mono font-bold', homeWon ? 'text-win' : 'text-text-muted')}>{m.homeScore}</span>}
                              </div>
                              <div className="h-px bg-border-subtle" />
                              <div className={cn('flex items-center gap-1.5 px-2 py-1', awayWon && 'bg-win/5')}>
                                <span className="text-[9px] font-mono text-text-muted w-3">{m.awaySeed}</span>
                                {away && <TeamLogo abbrev={away.teamAbbrev} color={away.teamColor} size="sm" />}
                                <span className={cn('flex-1 truncate', awayWon ? 'text-win font-medium' : homeWon ? 'text-text-muted' : 'text-text-primary')}>
                                  {away?.teamAbbrev || 'TBD'}
                                </span>
                                {hasResult && <span className={cn('font-mono font-bold', awayWon ? 'text-win' : 'text-text-muted')}>{m.awayScore}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
