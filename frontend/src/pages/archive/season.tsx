import { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { pokemonRoute } from '@/lib/pokemon-route';
import { RecordDisplay } from '@/components/record-display';
import { ChampionBanner } from '@/components/champion-banner';
import { cn } from '@/lib/utils';
import { MEDAL_COLORS } from '@/lib/constants';
import {
  Trophy, ChevronDown, Medal, Archive as ArchiveIcon, ArrowRight, Award,
} from 'lucide-react';
// Note: SeasonLeaderStrip ("Season top kills" panel) and SeasonWideAwards
// were removed per design decision. Season-scoped awards now live only on
// the per-league deep-dive (/archive/:seasonId/:leagueId, awards tab) and
// on the per-league MVPs row inside LeagueArchiveCard.

/**
 * Season hub page at /archive/:seasonId. Per-season overview surfacing the
 * 3 leagues' top-line standings, champions, and MVP medals. Each league
 * card links into the per-league deep-dive at /archive/:seasonId/:leagueId.
 *
 * The season picker that lived on the standalone /archive page has moved
 * up to the hub (/archive); this page is single-season scoped.
 */

interface ArchiveSeason {
  id: number;
  seasonNumber: number;
  phase: string;
  archived?: boolean;
}

interface ArchiveRosterMon {
  name: string;
  tier: number;
  types: string[];
  isTeraCaptain: boolean;
}

interface ArchiveTeam {
  id: string;
  coachName: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  rank: number;
  /** Final placement (1 = Champion, 2 = Runner-up, etc.). NULL pre-archive. */
  finishPosition: number | null;
  /** Pre-formatted finish label paired with finishPosition. */
  finishLabel: string | null;
  roster: ArchiveRosterMon[];
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

interface SeasonAward {
  pinId: number;
  pinDefId: string;
  userId: number;
  username: string;
  displayName: string | null;
  defName: string;
  defIconName: string;
  defColor: string;
  defCategory: string;
  defIsAuto: boolean;
  metadata: any;
}

interface SeasonAwardsPayload {
  seasonId: number;
  seasonNumber: number;
  archived: boolean;
  pins: SeasonAward[];
}

export function ArchiveSeasonPage() {
  const { seasonId: seasonIdParam } = useParams<{ seasonId: string }>();
  const seasonId = seasonIdParam ? parseInt(seasonIdParam) : null;
  const [season, setSeason] = useState<ArchiveSeason | null>(null);
  const [leagues, setLeagues] = useState<ArchiveLeague[]>([]);
  const [awards, setAwards] = useState<SeasonAwardsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!seasonId) return;
    setLoading(true);
    Promise.all([
      fetch('/api/seasons').then(r => r.json() as Promise<ArchiveSeason[]>),
      fetch(`/api/seasons/${seasonId}/leagues`).then(r => r.json() as Promise<ArchiveLeague[]>),
      fetch(`/api/archive/seasons/${seasonId}/awards`).then(r => r.json() as Promise<SeasonAwardsPayload>).catch(() => null),
    ])
      .then(([seasons, lg, aw]) => {
        setSeason(seasons.find(s => s.id === seasonId) ?? null);
        setLeagues(lg);
        setAwards(aw);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [seasonId]);

  if (!seasonId) {
    return <div className="text-text-muted py-20 text-center">Missing season id.</div>;
  }
  if (loading) return <div className="text-text-muted py-20 text-center text-sm">Loading season…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span className="text-purple-400">Season</span>{' '}
            <span className="text-text-primary">{season ? `S${season.seasonNumber}` : 'Archive'}</span>
          </h1>
          <p className="text-sm text-text-muted">
            {leagues.length} leagues
            {' · '}
            {leagues.reduce((s, l) => s + l.teams.length, 0)} teams
            {season?.phase === 'offseason' && ' · Completed'}
          </p>
        </div>
      </div>

      {leagues.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-surface-raised/40 py-16 px-6 flex flex-col items-center justify-center text-center">
          <div className="rounded-full p-4 bg-purple-400/5 border border-purple-400/20 mb-4">
            <ArchiveIcon size={28} className="text-purple-400/70" />
          </div>
          <h2 className="text-base font-medium text-text-primary mb-1">No data for this season</h2>
        </div>
      ) : (
        <>
          <div className="space-y-8">
            {leagues.map(league => (
              <LeagueArchiveCard
                key={league.id}
                seasonId={seasonId}
                seasonNumber={season?.seasonNumber ?? null}
                league={league}
                awards={(awards?.pins ?? []).filter(p => leagueOwnsAward(p, league))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** True if the award's metadata.teamId points at a team in this league.
 *  Falls back to false (not displayed in this league's section) so awards
 *  with no teamId — career-scoped pins — don't get fanned out 3x. */
function leagueOwnsAward(award: SeasonAward, league: ArchiveLeague): boolean {
  const teamId = award.metadata?.teamId;
  if (typeof teamId !== 'string') return false;
  return league.teams.some(t => t.id === teamId);
}

function LeagueArchiveCard({
  seasonId, seasonNumber, league, awards,
}: {
  seasonId: number;
  seasonNumber: number | null;
  league: ArchiveLeague;
  awards: SeasonAward[];
}) {
  const [expanded, setExpanded] = useState(false);
  const teamMap = useMemo(() => new Map(league.teams.map(t => [t.id, t])), [league.teams]);
  const champion = league.champion ? teamMap.get(league.champion) : null;

  const derivedChampion = useMemo(() => {
    // Prefer stamped finishPosition === 1 (set post-archive); fall back to
    // backend's `champion` (finals-derived) and finally to the most-recent
    // playoff-match winner for in-progress brackets.
    const stamped = league.teams.find(t => t.finishPosition === 1);
    if (stamped) return stamped;
    if (champion) return champion;
    const sorted = [...league.playoffs].reverse();
    for (const m of sorted) {
      if (m.homeScore != null && m.awayScore != null) {
        const winnerId = m.homeScore > m.awayScore ? m.homeTeamId : m.awayTeamId;
        return teamMap.get(winnerId) || null;
      }
    }
    return null;
  }, [champion, league.playoffs, league.teams, teamMap]);

  const leagueDeepLink = `/archive/${seasonId}/${league.id}`;

  // Find the runner-up (loser of the finals) so the ChampionBanner can show it.
  const runnerUp = useMemo(() => {
    const finals = league.playoffs.find(m => m.playoffRound === 'f' && m.homeScore != null);
    if (!finals || !derivedChampion) return null;
    const isHomeWinner = derivedChampion.id === finals.homeTeamId;
    const loserId = isHomeWinner ? finals.awayTeamId : finals.homeTeamId;
    return teamMap.get(loserId) ?? null;
  }, [derivedChampion, league.playoffs, teamMap]);

  const finalsScore = useMemo(() => {
    const finals = league.playoffs.filter(m => m.playoffRound === 'f' && m.homeScore != null && m.awayScore != null);
    if (finals.length === 0 || !derivedChampion) return null;
    let winnerSum = 0, loserSum = 0;
    for (const f of finals) {
      const isHomeWinner = derivedChampion.id === f.homeTeamId;
      winnerSum += isHomeWinner ? (f.homeScore ?? 0) : (f.awayScore ?? 0);
      loserSum += isHomeWinner ? (f.awayScore ?? 0) : (f.homeScore ?? 0);
    }
    return { winner: winnerSum, loser: loserSum };
  }, [derivedChampion, league.playoffs]);

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      <div className="h-1.5" style={{ backgroundColor: league.color }} />

      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg font-heading" style={{ color: league.color }}>
              <Link to={leagueDeepLink} className="hover:underline underline-offset-4">
                {league.name}
              </Link>
            </CardTitle>
            <Badge variant="outline" className="text-[10px] text-text-muted">
              {league.teams.length} teams
            </Badge>
          </div>

          <Link
            to={leagueDeepLink}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            View league archive
            <ArrowRight size={12} />
          </Link>
        </div>
      </CardHeader>

      {derivedChampion && (
        <div className="px-4 pb-4">
          <ChampionBanner
            team={{
              id: derivedChampion.id,
              coachName: derivedChampion.coachName,
              teamName: derivedChampion.teamName,
              teamAbbrev: derivedChampion.teamAbbrev,
              teamColor: derivedChampion.teamColor,
              coachUsername: derivedChampion.coachName.toLowerCase().replace(/\s+/g, ''),
            }}
            league={{
              id: league.id,
              name: league.name,
              color: league.color,
              seasonNumber,
              seasonId,
            }}
            finalScore={finalsScore}
            runnerUp={runnerUp ? {
              id: runnerUp.id,
              teamAbbrev: runnerUp.teamAbbrev,
              teamName: runnerUp.teamName,
              teamColor: runnerUp.teamColor,
            } : null}
            roster={derivedChampion.roster.map(r => ({ name: r.name, isTeraCaptain: r.isTeraCaptain }))}
            finishLabel={derivedChampion.finishLabel}
            compact
          />
        </div>
      )}

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {league.teams.slice(0, 6).map((team, i) => (
            <ArchiveTeamRow key={team.id} seasonId={seasonId} leagueId={league.id} team={team} rank={i + 1} />
          ))}
        </div>

        {league.mvps.length > 0 && (
          <div className="flex items-center gap-4 pt-2 border-t border-border-subtle">
            <div className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider shrink-0">
              <Medal size={12} />
              Season MVPs
            </div>
            <div className="flex gap-3 flex-wrap">
              {league.mvps.map((mvp, i) => {
                const team = teamMap.get(mvp.teamId);
                return (
                  <div key={mvp.pokemonName} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-[10px] font-bold',
                        i === 0 ? 'text-draw' : i === 1 ? 'text-text-secondary' : '',
                      )}
                      style={i === 2 ? { color: MEDAL_COLORS.bronze } : undefined}
                    >
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

        {awards.length > 0 && (
          <AwardsStrip awards={awards} />
        )}

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {league.teams.slice(6).map((team, i) => (
                <ArchiveTeamRow
                  key={team.id}
                  seasonId={seasonId}
                  leagueId={league.id}
                  team={team}
                  rank={i + 7}
                  compact
                />
              ))}
            </div>

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

/** Inline awards display — one chip per pin, lucide-icon tinted by the
 *  pin def's color. Click links to the recipient's coach profile. */
function AwardsStrip({ awards }: { awards: SeasonAward[] }) {
  // Lazy-resolve lucide icon at render time. Falls back to Award if the
  // def references something we don't ship.
  return (
    <div className="flex items-center gap-3 pt-2 border-t border-border-subtle flex-wrap">
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider shrink-0">
        <Award size={12} />
        Awards
      </div>
      <div className="flex gap-2 flex-wrap">
        {awards.map(a => (
          <Link
            key={a.pinId}
            to={`/coach/${a.username}`}
            className="flex items-center gap-1.5 px-2 py-1 rounded border bg-surface-overlay/40 hover:bg-surface-overlay transition-colors"
            style={{ borderColor: `${a.defColor}33` }}
            title={`${a.defName} — ${a.displayName ?? a.username}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: a.defColor }}
            />
            <span className="text-[11px] font-medium text-text-primary">{a.defName}</span>
            <span className="text-[10px] text-text-muted">·</span>
            <span className="text-[10px] text-text-muted">{a.displayName ?? a.username}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ArchiveTeamRow({
  seasonId, leagueId, team, rank, compact,
}: {
  seasonId: number; leagueId: string; team: ArchiveTeam; rank: number; compact?: boolean;
}) {
  const [showRoster, setShowRoster] = useState(false);
  const { openSideCard } = usePokemonSideCard();

  return (
    <div
      className={cn(
        'relative rounded-md transition-colors group',
        compact ? 'px-2 py-1' : rank <= 3 ? 'bg-surface-overlay/30 px-3 py-2' : 'px-3 py-2',
      )}
      onMouseEnter={() => setShowRoster(true)}
      onMouseLeave={() => setShowRoster(false)}
    >
      <Link to={`/archive/${seasonId}/${leagueId}/${team.id}`} className="flex items-center gap-2.5">
        <span className={cn(
          'text-xs font-bold font-mono w-5 text-center shrink-0',
          rank === 1 ? 'text-draw' : rank <= 3 ? 'text-neon' : 'text-text-muted',
        )}>
          {rank}
        </span>
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
        <div className="flex-1 min-w-0">
          <span className={cn(
            'text-xs font-medium truncate block',
            compact ? 'text-text-secondary' : 'text-text-primary',
          )}>
            {team.teamName}
          </span>
          {!compact && <span className="text-[10px] text-text-muted">{team.coachName}</span>}
        </div>
        <RecordDisplay
          wins={team.record.wins}
          losses={team.record.losses}
          differential={team.record.differential}
          className="text-[10px]"
        />
      </Link>

      {showRoster && team.roster.length > 0 && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-border-default bg-surface-raised shadow-card-lg p-2.5 space-y-1">
          <div className="text-[9px] text-text-muted uppercase tracking-wider mb-1">
            Roster · {team.roster.reduce((s, r) => s + r.tier, 0)}pts
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {team.roster.sort((a, b) => b.tier - a.tier).map(mon => (
              <div key={mon.name} className="flex items-center gap-1.5">
                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSideCard(mon.name); }} title="View details">
                  <PokemonSprite name={mon.name} size="xs" />
                </button>
                <Link
                  to={pokemonRoute(mon.name)}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] text-text-primary truncate flex-1 hover:text-neon hover:underline transition-colors"
                >
                  {mon.name}
                </Link>
                <span className="text-[9px] font-mono text-text-muted">{mon.tier}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
