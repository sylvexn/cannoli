/**
 * Recent picks/trades horizontal carousel for the team detail page.
 *
 * Sources from data already in the league context:
 *   - transactions (trade / FA / tera change rows touching this team)
 *   - completed matches (W/L card)
 *
 * We render a small, horizontally scrolling strip of the last 5–8 events.
 * Each card is a tiny narrative tile rather than a row in a table — the goal
 * is "here's what's happened to this team lately" at a glance.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight, ScrollText, Swords, Star, UserPlus, UserMinus,
} from 'lucide-react';
import type { Player } from '@/lib/types';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { pokemonRoute } from '@/lib/pokemon-route';

interface RecentEventsProps {
  player: Player;
  /** Cap on how many events to render. Default 8. */
  limit?: number;
}

type Tile =
  | { kind: 'trade'; week: number; out: string[]; in: string[]; otherTeamId: string | null; sortKey: number }
  | { kind: 'fa-add'; week: number; pokemon: string; sortKey: number }
  | { kind: 'fa-drop'; week: number; pokemon: string; sortKey: number }
  | { kind: 'tera'; week: number; pokemon: string; sortKey: number }
  | { kind: 'match'; week: number; opponentId: string; result: 'W' | 'L' | 'D'; score: string; sortKey: number };

export function RecentEvents({ player, limit = 8 }: RecentEventsProps) {
  const { transactions, matches, players } = useLeagueData();
  const league = useLeague();
  const leagueUrl = useLeagueUrl();
  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];

    // Transactions: collapse a single trade (which writes 2 rows, one per
    // direction) into a single tile by grouping on (week, otherTeamId,
    // pokemonOut+pokemonIn pair) — pokemonOut on this team's row matches
    // pokemonIn on the counterparty's row, but we only care about this side.
    const seenTradeKey = new Set<string>();
    for (const tx of transactions) {
      if (tx.teamId !== player.id) continue;
      // Higher week first when sorting; tie-break by id desc (closest to
      // most-recent across week-0 events like draft adds).
      const sortKey = tx.week * 1_000_000 + tx.id;
      if (tx.type === 'trade') {
        // Aggregate per (week, otherTeam) so multi-pokemon trades stay one tile.
        const key = `${tx.week}|${tx.otherTeamId ?? 'null'}`;
        if (seenTradeKey.has(key)) {
          // Find the existing tile and append the additional pokemon names.
          const existing = out.find(t => t.kind === 'trade' && t.week === tx.week && t.otherTeamId === (tx.otherTeamId ?? null)) as Extract<Tile, { kind: 'trade' }> | undefined;
          if (existing) {
            if (tx.pokemonOut) existing.out.push(tx.pokemonOut);
            if (tx.pokemonIn) existing.in.push(tx.pokemonIn);
          }
          continue;
        }
        seenTradeKey.add(key);
        out.push({
          kind: 'trade',
          week: tx.week,
          out: tx.pokemonOut ? [tx.pokemonOut] : [],
          in: tx.pokemonIn ? [tx.pokemonIn] : [],
          otherTeamId: tx.otherTeamId,
          sortKey,
        });
      } else if (tx.type === 'fa') {
        if (tx.pokemonIn) out.push({ kind: 'fa-add', week: tx.week, pokemon: tx.pokemonIn, sortKey });
        if (tx.pokemonOut) out.push({ kind: 'fa-drop', week: tx.week, pokemon: tx.pokemonOut, sortKey: sortKey - 0.1 });
      } else if (tx.type === 'tera_change' && tx.teraPokemon) {
        out.push({ kind: 'tera', week: tx.week, pokemon: tx.teraPokemon, sortKey });
      }
    }

    // Match results — only completed (with scores).
    for (const m of matches) {
      if (m.homePlayer !== player.id && m.awayPlayer !== player.id) continue;
      if (m.homeScore == null || m.awayScore == null) continue;
      const isHome = m.homePlayer === player.id;
      const myScore = isHome ? m.homeScore : m.awayScore;
      const oppScore = isHome ? m.awayScore : m.homeScore;
      const opponentId = isHome ? m.awayPlayer : m.homePlayer;
      const result: 'W' | 'L' | 'D' = myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'D';
      // Match weeks share the same numeric space as transactions; nudge them
      // so the result lands roughly alongside that week's other activity.
      out.push({
        kind: 'match',
        week: m.week,
        opponentId,
        result,
        score: `${myScore}-${oppScore}`,
        sortKey: m.week * 1_000_000 + 500_000, // mid-week nudge
      });
    }

    out.sort((a, b) => b.sortKey - a.sortKey);
    return out.slice(0, limit);
  }, [transactions, matches, player.id, limit]);

  if (tiles.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-default bg-surface-raised p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-text-muted flex items-center gap-1.5">
          <ScrollText size={11} />
          Recent moves
        </h3>
        <span className="text-[9px] font-mono text-text-muted/70">
          {tiles.length} event{tiles.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {tiles.map((t, i) => (
          <EventTile
            key={`${t.kind}-${t.week}-${i}`}
            tile={t}
            leagueColor={league.color}
            playerById={playerById}
            opponentLink={leagueUrl}
          />
        ))}
      </div>
    </div>
  );
}

function EventTile({
  tile, leagueColor, playerById, opponentLink,
}: {
  tile: Tile;
  leagueColor: string;
  playerById: Map<string, Player>;
  opponentLink: (path: string) => string;
}) {
  if (tile.kind === 'trade') {
    const other = tile.otherTeamId ? playerById.get(tile.otherTeamId) : null;
    return (
      <div className="shrink-0 w-[180px] rounded-md border border-border-default bg-surface-overlay/40 px-2.5 py-2 flex flex-col gap-1.5">
        <Header icon={ArrowLeftRight} label="Trade" week={tile.week} accent={leagueColor} />
        <div className="flex items-center gap-1 flex-wrap">
          {tile.in.slice(0, 3).map(p => (
            <Link key={p} to={pokemonRoute(p)} title={p} className="hover:scale-110 transition-transform">
              <PokemonSprite name={p} size="xs" />
            </Link>
          ))}
          {tile.in.length > 3 && (
            <span className="text-[9px] font-mono text-text-muted">+{tile.in.length - 3}</span>
          )}
        </div>
        {other && (
          <Link
            to={opponentLink(`/teams/${other.id}`)}
            className="text-[10px] font-mono text-text-muted hover:text-neon transition-colors flex items-center gap-1"
          >
            <span>from</span>
            <TeamLogo abbrev={other.teamAbbrev} color={other.teamColor} size="sm" />
            <span className="truncate">{other.teamAbbrev}</span>
          </Link>
        )}
      </div>
    );
  }

  if (tile.kind === 'fa-add') {
    return (
      <div className="shrink-0 w-[140px] rounded-md border border-border-default bg-surface-overlay/40 px-2.5 py-2 flex flex-col gap-1.5">
        <Header icon={UserPlus} label="FA pickup" week={tile.week} accent="#a78bfa" />
        <Link to={pokemonRoute(tile.pokemon)} className="flex items-center gap-1.5 hover:text-neon transition-colors">
          <PokemonSprite name={tile.pokemon} size="sm" />
          <span className="text-[11px] truncate text-text-secondary hover:text-neon">{tile.pokemon}</span>
        </Link>
      </div>
    );
  }

  if (tile.kind === 'fa-drop') {
    return (
      <div className="shrink-0 w-[140px] rounded-md border border-border-default bg-surface-overlay/40 px-2.5 py-2 flex flex-col gap-1.5">
        <Header icon={UserMinus} label="Released" week={tile.week} accent="#f87171" />
        <Link to={pokemonRoute(tile.pokemon)} className="flex items-center gap-1.5 hover:text-neon transition-colors">
          <PokemonSprite name={tile.pokemon} size="sm" />
          <span className="text-[11px] truncate text-text-secondary hover:text-neon">{tile.pokemon}</span>
        </Link>
      </div>
    );
  }

  if (tile.kind === 'tera') {
    return (
      <div className="shrink-0 w-[140px] rounded-md border border-border-default bg-surface-overlay/40 px-2.5 py-2 flex flex-col gap-1.5">
        <Header icon={Star} label="Tera change" week={tile.week} accent="#fbbf24" />
        <Link to={pokemonRoute(tile.pokemon)} className="flex items-center gap-1.5 hover:text-neon transition-colors">
          <PokemonSprite name={tile.pokemon} size="sm" />
          <span className="text-[11px] truncate text-text-secondary hover:text-neon">{tile.pokemon}</span>
        </Link>
      </div>
    );
  }

  // match
  const opp = playerById.get(tile.opponentId);
  const resColor = tile.result === 'W' ? '#4ade80' : tile.result === 'L' ? '#f87171' : '#fbbf24';
  return (
    <div className="shrink-0 w-[150px] rounded-md border border-border-default bg-surface-overlay/40 px-2.5 py-2 flex flex-col gap-1.5">
      <Header icon={Swords} label={`Week ${tile.week}`} week={tile.week} accent={resColor} hideWeek />
      <div className="flex items-center gap-1.5">
        <span className="text-[14px] font-bold tabular-nums" style={{ color: resColor }}>
          {tile.result}
        </span>
        <span className="text-[11px] font-mono tabular-nums text-text-muted">{tile.score}</span>
      </div>
      {opp && (
        <Link
          to={opponentLink(`/teams/${opp.id}`)}
          className="text-[10px] font-mono text-text-muted hover:text-neon transition-colors flex items-center gap-1"
        >
          <span>vs</span>
          <TeamLogo abbrev={opp.teamAbbrev} color={opp.teamColor} size="sm" />
          <span className="truncate">{opp.teamAbbrev}</span>
        </Link>
      )}
    </div>
  );
}

function Header({
  icon: Icon, label, week, accent, hideWeek,
}: {
  icon: typeof ArrowLeftRight;
  label: string;
  week: number;
  accent: string;
  hideWeek?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider">
      <Icon size={10} style={{ color: accent }} />
      <span className="text-text-muted">{label}</span>
      {!hideWeek && (
        <span className="ml-auto text-text-muted/60 tabular-nums">w{week}</span>
      )}
    </div>
  );
}
