import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import { cn } from '@/lib/utils';
import { Sparkles, TrendingUp, TrendingDown, Repeat, UserPlus, Crown, Award, Play } from 'lucide-react';
import * as Icons from 'lucide-react';
import { MEDAL_COLORS } from '@/lib/constants';

/**
 * Team-season report at /archive/:seasonId/:leagueId/:teamId. Renders
 * everything we know about one team in one season:
 *   - Headline: logo, team/coach name, final record + ranking summary
 *   - Roster grouped by acquisition method (drafted vs trade vs F/A)
 *   - Week-by-week scoreline grid with replay links where present
 *   - Per-Pokemon K/D table (kills first)
 *   - Transaction ledger (every move involving this team)
 *   - Awards: any pins minted to this team's coach for this season
 */

interface TeamSeason {
  team: {
    id: string;
    coachName: string;
    teamName: string;
    teamAbbrev: string;
    teamColor: string;
    userId: number | null;
    /** Final placement (1 = Champion, 2 = Runner-up, 3/4 = Semifinalist,
     *  5–8 = Quarterfinalist, 9+ = Regular Season). NULL pre-archive. */
    finishPosition: number | null;
    /** Pre-formatted label paired with finishPosition. */
    finishLabel: string | null;
  };
  league: {
    id: string;
    name: string;
    color: string;
    seasonId: number;
    seasonNumber: number | null;
    archived: boolean;
  } | null;
  roster: RosterMon[];
  weekByWeek: WeekRow[];
  transactions: TxnRow[];
  pokemonStats: { pokemonName: string; kills: number; deaths: number; gp: number; teraUsed: number }[];
  otherTeams: { id: string; coachName: string; teamName: string; teamAbbrev: string; teamColor: string }[];
}

interface RosterMon {
  name: string;
  nickname: string | null;
  tier: number;
  isTeraCaptain: boolean;
  teraTypes: string[];
  isShiny: boolean;
  acquiredVia: 'draft' | 'trade' | 'fa' | string;
  acquiredWeek: number | null;
}

interface WeekRow {
  matchId: string;
  week: number;
  phase: string;
  playoffRound: string | null;
  opponentId: string;
  myScore: number | null;
  oppScore: number | null;
  result: 'W' | 'L' | 'T' | null;
  replayUrl: string | null;
  forfeitedBy: 'home' | 'away' | 'both' | null;
}

interface TxnRow {
  id: number;
  week: number;
  type: 'fa' | 'trade' | 'tera_change';
  teamId: string;
  otherTeamId: string | null;
  pokemonOut: string | null;
  pokemonIn: string | null;
  pointsOut: number | null;
  pointsIn: number | null;
  teraPokemon: string | null;
}

interface AwardRow {
  pinId: number;
  pinDefId: string;
  defName: string;
  defDescription: string;
  defIconName: string;
  defColor: string;
  metadata: any;
}

export function ArchiveTeamPage() {
  const { seasonId, leagueId, teamId } = useParams<{ seasonId: string; leagueId: string; teamId: string }>();
  const [data, setData] = useState<TeamSeason | null>(null);
  const [awards, setAwards] = useState<AwardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId || !teamId) return;
    setLoading(true);
    fetch(`/api/archive/leagues/${leagueId}/teams/${teamId}`)
      .then(r => r.json())
      .then((d: TeamSeason) => {
        setData(d);
        if (d?.league?.seasonId && d.team.userId) {
          fetch(`/api/archive/seasons/${d.league.seasonId}/awards`)
            .then(r => r.json())
            .then((aw: { pins: any[] }) => {
              const mine = aw.pins.filter(p => p.userId === d.team.userId && p.metadata?.teamId === d.team.id);
              setAwards(mine);
            })
            .catch(() => {});
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [leagueId, teamId]);

  const otherById = useMemo(
    () => new Map((data?.otherTeams ?? []).map(t => [t.id, t])),
    [data?.otherTeams],
  );

  const aggregate = useMemo(() => {
    if (!data) return null;
    const wins = data.weekByWeek.filter(w => w.result === 'W' && w.phase === 'regular').length;
    const losses = data.weekByWeek.filter(w => w.result === 'L' && w.phase === 'regular').length;
    const ties = data.weekByWeek.filter(w => w.result === 'T' && w.phase === 'regular').length;
    const totalKills = data.pokemonStats.reduce((s, p) => s + p.kills, 0);
    const totalDeaths = data.pokemonStats.reduce((s, p) => s + p.deaths, 0);
    const playoffMatches = data.weekByWeek.filter(w => w.phase === 'playoffs');
    return { wins, losses, ties, totalKills, totalDeaths, playoffMatches };
  }, [data]);

  if (loading) return <div className="text-text-muted py-20 text-center text-sm">Loading team…</div>;
  if (!data || !('team' in data)) return <div className="text-text-muted py-20 text-center">Team not found.</div>;

  const { team, league, roster, weekByWeek, transactions, pokemonStats } = data;
  const coachUsername = team.coachName.toLowerCase().replace(/\s+/g, '');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="xl" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span style={{ color: team.teamColor }}>{team.teamAbbrev}</span>{' '}
            <span className="text-text-primary truncate">{team.teamName}</span>
          </h1>
          <p className="text-sm text-text-muted flex items-center gap-2 flex-wrap">
            {team.userId ? (
              <Link to={`/coach/${coachUsername}`} className="hover:text-text-primary hover:underline">
                {team.coachName}
              </Link>
            ) : team.coachName}
            {league && (
              <>
                <span>·</span>
                <Link to={`/archive/${seasonId}/${league.id}`} className="hover:text-text-primary hover:underline" style={{ color: league.color }}>
                  {league.name}
                </Link>
                <span>·</span>
                <span>S{league.seasonNumber}</span>
              </>
            )}
          </p>
        </div>

        {aggregate && (
          <div className="flex gap-3 items-stretch flex-wrap">
            <StatChip label="W-L" value={`${aggregate.wins}-${aggregate.losses}${aggregate.ties ? `-${aggregate.ties}` : ''}`} />
            <StatChip label="Kills" value={String(aggregate.totalKills)} accent="#ef4444" />
            <StatChip label="Deaths" value={String(aggregate.totalDeaths)} accent="#94a3b8" />
            {aggregate.playoffMatches.length > 0 && (
              <StatChip label="Playoffs" value={`${aggregate.playoffMatches.filter(m => m.result === 'W').length}-${aggregate.playoffMatches.filter(m => m.result === 'L').length}`} accent="#fbbf24" />
            )}
            {team.finishLabel && (
              <FinishChip position={team.finishPosition} label={team.finishLabel} />
            )}
          </div>
        )}
      </div>

      {/* Awards strip */}
      {awards.length > 0 && (
        <Card className="bg-surface-raised border-border-default">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted shrink-0">
              <Award size={12} className="text-draw" />
              Season awards
            </div>
            {awards.map(a => {
              const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>>)[a.defIconName] ?? Award;
              return (
                <div
                  key={a.pinId}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
                  style={{ borderColor: `${a.defColor}55`, backgroundColor: `${a.defColor}15` }}
                  title={a.defDescription}
                >
                  <IconComp size={11} style={{ color: a.defColor }} />
                  <span className="text-[11px] font-medium" style={{ color: a.defColor }}>{a.defName}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Roster grouped by acquisition */}
        <RosterCard roster={roster} />

        {/* Week by week */}
        <Card className="bg-surface-raised border-border-default lg:col-span-2">
          <CardContent className="p-3 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Week-by-week ({weekByWeek.length})
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5">
              {weekByWeek.map(m => {
                const opp = otherById.get(m.opponentId);
                return (
                  <div
                    key={m.matchId}
                    className={cn(
                      'rounded border px-2 py-1.5 text-[11px] flex flex-col gap-0.5',
                      m.result === 'W' ? 'border-win/40 bg-win/5'
                      : m.result === 'L' ? 'border-loss/40 bg-loss/5'
                      : m.result === 'T' ? 'border-draw/40 bg-draw/5'
                      : 'border-border-subtle',
                    )}
                  >
                    <div className="flex items-center justify-between text-[9px] font-mono uppercase text-text-muted">
                      <span>
                        {m.phase === 'playoffs' ? (m.playoffRound?.toUpperCase() ?? 'PO') : `W${m.week}`}
                      </span>
                      {m.replayUrl && (
                        <a
                          href={m.replayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:underline flex items-center"
                        >
                          <Play size={9} />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {opp && <TeamLogo abbrev={opp.teamAbbrev} color={opp.teamColor} size="sm" />}
                      <span className="text-text-primary truncate text-[10px]">{opp?.teamAbbrev ?? '???'}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      {m.forfeitedBy && (
                        <span className="text-[8px] uppercase text-loss">FF</span>
                      )}
                      <span className={cn(
                        'font-mono font-bold',
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per-Pokemon stats */}
        <Card className="bg-surface-raised border-border-default">
          <CardContent className="p-3 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
              Per-Pokemon ({pokemonStats.length})
            </div>
            <div className="grid grid-cols-[1.5rem_2fr_3rem_3rem_3rem] gap-1.5 px-1 text-[9px] font-mono uppercase tracking-wider text-text-muted">
              <span></span>
              <span>Pokemon</span>
              <span className="text-right">K</span>
              <span className="text-right">D</span>
              <span className="text-right">GP</span>
            </div>
            {pokemonStats.map(s => (
              <div key={s.pokemonName} className="grid grid-cols-[1.5rem_2fr_3rem_3rem_3rem] gap-1.5 items-center px-1 py-0.5 text-xs hover:bg-surface-overlay/50 rounded">
                <PokemonSprite name={s.pokemonName} size="xs" />
                <Link
                  to={pokemonRoute(s.pokemonName)}
                  className="flex-1 truncate hover:text-neon transition-colors flex items-center gap-1"
                >
                  {s.pokemonName}
                  {s.teraUsed > 0 && (
                    <Sparkles size={9} className="text-purple-400" />
                  )}
                </Link>
                <span className="text-right font-mono text-win">{s.kills}</span>
                <span className="text-right font-mono text-loss">{s.deaths}</span>
                <span className="text-right font-mono text-text-muted">{s.gp}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Transactions */}
        <TransactionsCard transactions={transactions} otherById={otherById} thisTeamId={team.id} />
      </div>
    </div>
  );
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-raised px-3 py-2 min-w-[60px]">
      <div className="text-[9px] font-mono uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-base font-mono font-bold" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

/** Chip flavoured by playoff placement — gold/silver/bronze for top 3,
 *  purple for QF, neutral for regular-season. Lives next to the W-L stat
 *  chips on the team-season header. */
function FinishChip({ position, label }: { position: number | null; label: string }) {
  let color = 'var(--text-secondary)';
  let bg = 'transparent';
  let border = 'var(--border-default)';
  if (position === 1) {
    color = MEDAL_COLORS.gold; bg = `${MEDAL_COLORS.gold}15`; border = `${MEDAL_COLORS.gold}55`;
  } else if (position === 2) {
    color = MEDAL_COLORS.silver; bg = `${MEDAL_COLORS.silver}15`; border = `${MEDAL_COLORS.silver}55`;
  } else if (position === 3 || position === 4) {
    color = MEDAL_COLORS.bronze; bg = `${MEDAL_COLORS.bronze}15`; border = `${MEDAL_COLORS.bronze}55`;
  } else if (position != null && position <= 8) {
    color = '#a78bfa'; bg = '#a78bfa15'; border = '#a78bfa44';
  }
  return (
    <div
      className="rounded-lg border px-3 py-2 min-w-[60px] flex flex-col justify-center"
      style={{ backgroundColor: bg, borderColor: border }}
    >
      <div className="text-[9px] font-mono uppercase tracking-wider text-text-muted">Finish</div>
      <div className="text-sm font-mono font-bold" style={{ color }}>{label}</div>
    </div>
  );
}

function RosterCard({ roster }: { roster: RosterMon[] }) {
  const drafted = roster.filter(r => r.acquiredVia === 'draft');
  const traded = roster.filter(r => r.acquiredVia === 'trade');
  const fa = roster.filter(r => r.acquiredVia === 'fa');
  const other = roster.filter(r => !['draft', 'trade', 'fa'].includes(r.acquiredVia));

  const Section = ({ title, mons, icon: Icon }: { title: string; mons: RosterMon[]; icon: React.ComponentType<{ size?: number; className?: string }> }) => (
    mons.length === 0 ? null : (
      <div>
        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-text-muted mb-1">
          <Icon size={10} />
          {title} ({mons.length})
        </div>
        <div className="space-y-0.5">
          {mons.sort((a, b) => b.tier - a.tier).map(mon => (
            <div key={mon.name} className="flex items-center gap-1.5 text-xs">
              <PokemonSprite name={mon.name} size="xs" />
              <Link to={pokemonRoute(mon.name)} className="flex-1 truncate hover:text-neon transition-colors">
                {mon.nickname ? (
                  <>
                    <span className="text-text-primary">{mon.nickname}</span>
                    <span className="text-text-muted"> · {mon.name}</span>
                  </>
                ) : (
                  <span className="text-text-primary">{mon.name}</span>
                )}
              </Link>
              <span className="font-mono text-[10px] text-text-muted">{mon.tier}</span>
              {mon.isTeraCaptain && (
                <Crown size={10} className="text-purple-400" />
              )}
              {mon.acquiredWeek != null && mon.acquiredVia !== 'draft' && (
                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 border-border-default text-text-muted">
                  W{mon.acquiredWeek}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  );

  return (
    <Card className="bg-surface-raised border-border-default lg:col-span-1">
      <CardContent className="p-3 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          Roster ({roster.length})
        </div>
        <Section title="Drafted" mons={drafted} icon={Crown} />
        <Section title="Trade arrivals" mons={traded} icon={Repeat} />
        <Section title="Free agency" mons={fa} icon={UserPlus} />
        <Section title="Other" mons={other} icon={Award} />
      </CardContent>
    </Card>
  );
}

function TransactionsCard({
  transactions, otherById, thisTeamId,
}: {
  transactions: TxnRow[];
  otherById: Map<string, { teamAbbrev: string; teamColor: string; teamName: string }>;
  thisTeamId: string;
}) {
  if (transactions.length === 0) {
    return (
      <Card className="bg-surface-raised border-border-default">
        <CardContent className="p-3 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Transactions
          </div>
          <div className="text-xs text-text-muted italic">No transactions this season.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="p-3 space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          Transactions ({transactions.length})
        </div>
        <div className="space-y-1">
          {transactions.map(t => {
            const isProposer = t.teamId === thisTeamId;
            // For trades, present from this team's perspective: pokemonOut/In already
            // describe what *t.teamId* gave/got, but the row may belong to the other team.
            const display = isProposer
              ? { out: t.pokemonOut, in: t.pokemonIn, ptsOut: t.pointsOut, ptsIn: t.pointsIn }
              : { out: t.pokemonIn, in: t.pokemonOut, ptsOut: t.pointsIn, ptsIn: t.pointsOut };

            const counterpartyId = isProposer ? t.otherTeamId : t.teamId;
            const counterparty = counterpartyId ? otherById.get(counterpartyId) : null;
            const TypeIcon = t.type === 'trade' ? Repeat : t.type === 'fa' ? UserPlus : Sparkles;

            return (
              <div key={t.id} className="flex items-center gap-1.5 text-[11px] py-0.5 flex-wrap">
                <span className="font-mono text-[10px] text-text-muted w-7 shrink-0">W{t.week}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[8px] uppercase tracking-wider px-1 py-0 h-3.5 shrink-0',
                    t.type === 'trade' ? 'border-purple-400/40 text-purple-400'
                    : t.type === 'fa' ? 'border-emerald-400/40 text-emerald-400'
                    : 'border-cyan-400/40 text-cyan-400',
                  )}
                >
                  <TypeIcon size={9} className="mr-0.5" />
                  {t.type === 'fa' ? 'F/A' : t.type === 'tera_change' ? 'Tera' : 'Trade'}
                </Badge>
                {display.out && (
                  <span className="text-loss flex items-center gap-1">
                    <TrendingDown size={10} />
                    <PokemonSprite name={display.out} size="xs" />
                    <Link to={pokemonRoute(display.out)} className="hover:underline">
                      {display.out}
                    </Link>
                  </span>
                )}
                {display.in && (
                  <span className="text-win flex items-center gap-1">
                    <TrendingUp size={10} />
                    <PokemonSprite name={display.in} size="xs" />
                    <Link to={pokemonRoute(display.in)} className="hover:underline">
                      {display.in}
                    </Link>
                  </span>
                )}
                {t.teraPokemon && (
                  <span className="text-purple-400 flex items-center gap-1">
                    <PokemonSprite name={t.teraPokemon} size="xs" />
                    {t.teraPokemon}
                  </span>
                )}
                {counterparty && (
                  <span className="ml-auto flex items-center gap-1 text-text-muted">
                    <span className="text-[9px]">w/</span>
                    <TeamLogo abbrev={counterparty.teamAbbrev} color={counterparty.teamColor} size="sm" />
                    <span>{counterparty.teamAbbrev}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
