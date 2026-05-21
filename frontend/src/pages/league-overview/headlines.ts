/**
 * Auto-derived "headlines" for the community home — surfaced as a small
 * strip above the activity feed. These are algorithmic, not authored:
 *
 *   - **Longest current streak**    (regular-phase only)
 *   - **Recent upset**              (lower seed beat top-3 in last completed match)
 *   - **Biggest trade**             (highest combined #pokemon swapped, last 5)
 *
 * The output is intentionally compact (3–5 cards). All data flows from
 * arrays already fetched on the league overview, so this module is just a
 * pure transformer — no extra network.
 */

import type { ApiTeam, ApiTrade, ApiActivityEvent } from '@/lib/api';
import type { League } from '@/lib/types';

export type Headline =
  | {
      kind: 'streak';
      teamId: string;
      leagueId: string;
      teamName: string;
      teamAbbrev: string;
      teamColor: string;
      streak: number;
    }
  | {
      kind: 'upset';
      leagueId: string;
      winnerName: string;
      winnerColor: string;
      loserName: string;
      timestamp: string | null;
    }
  | {
      kind: 'trade';
      leagueId: string;
      teamA: string;
      teamB: string;
      pokemonCount: number;
      timestamp: string;
    };

interface DeriveInput {
  leagues: League[];
  teamsPerLeague: Record<string, ApiTeam[]>;
  tradesPerLeague: Record<string, ApiTrade[]>;
  activity: ApiActivityEvent[];
}

const MAX_HEADLINES = 5;

export function deriveHeadlines({
  leagues, teamsPerLeague, tradesPerLeague, activity,
}: DeriveInput): Headline[] {
  const out: Headline[] = [];

  // ─── Longest streak ────────────────────────────────────────────────
  // Approximated from team record alone — we don't have raw match log
  // available without an extra fetch. Take the team with the highest
  // current win count across all leagues currently in `regular`. This is
  // a reasonable heuristic for the community-home strip; the precise
  // streak (consecutive Ws ignoring draws) lives on the team page.
  let bestStreak: { team: ApiTeam; league: League; wins: number } | null = null;
  for (const league of leagues) {
    if (league.season.phase !== 'regular') continue;
    const teams = teamsPerLeague[league.id] ?? [];
    for (const t of teams) {
      if (!bestStreak || t.record.wins > bestStreak.wins) {
        bestStreak = { team: t, league, wins: t.record.wins };
      }
    }
  }
  if (bestStreak && bestStreak.wins >= 2) {
    out.push({
      kind: 'streak',
      teamId: bestStreak.team.id,
      leagueId: bestStreak.league.id,
      teamName: bestStreak.team.teamName,
      teamAbbrev: bestStreak.team.teamAbbrev,
      teamColor: bestStreak.team.teamColor,
      streak: bestStreak.wins,
    });
  }

  // ─── Recent upset ──────────────────────────────────────────────────
  // Pull from activity log: match_reported events where the metadata
  // names a winner whose pre-match rank was lower than the loser's.
  // Without rank-at-time, fall back to current standings: if winner is
  // currently outside the top 3 and loser is in top 3, call it an upset.
  const upsetCandidates = activity
    .filter(e => e.type === 'match_reported' || e.type === 'match_completed')
    .slice(0, 12);
  outer: for (const e of upsetCandidates) {
    const meta = e.metadata as Record<string, unknown>;
    const winnerId = typeof meta.winnerId === 'string' ? meta.winnerId : null;
    const loserId = typeof meta.loserId === 'string' ? meta.loserId : null;
    if (!winnerId || !loserId || !e.leagueId) continue;
    const teams = teamsPerLeague[e.leagueId] ?? [];
    const winnerIdx = teams.findIndex(t => t.id === winnerId);
    const loserIdx = teams.findIndex(t => t.id === loserId);
    if (winnerIdx === -1 || loserIdx === -1) continue;
    if (winnerIdx > 2 && loserIdx <= 2) {
      const winner = teams[winnerIdx]!;
      const loser = teams[loserIdx]!;
      out.push({
        kind: 'upset',
        leagueId: e.leagueId,
        winnerName: winner.teamAbbrev,
        winnerColor: winner.teamColor,
        loserName: loser.teamAbbrev,
        timestamp: e.timestamp ?? null,
      });
      break outer;
    }
  }

  // ─── Biggest trade ─────────────────────────────────────────────────
  // Across all leagues, sort accepted trades by total pokemon involved
  // and take the largest. Ties broken by recency.
  const allAccepted: Array<{ trade: ApiTrade; leagueId: string }> = [];
  for (const [leagueId, trades] of Object.entries(tradesPerLeague)) {
    for (const t of trades) {
      if (t.status !== 'accepted') continue;
      allAccepted.push({ trade: t, leagueId });
    }
  }
  allAccepted.sort((a, b) => {
    const aSize = a.trade.offering.length + a.trade.requesting.length;
    const bSize = b.trade.offering.length + b.trade.requesting.length;
    if (bSize !== aSize) return bSize - aSize;
    return (b.trade.proposedAt ?? '').localeCompare(a.trade.proposedAt ?? '');
  });
  const biggest = allAccepted[0];
  if (biggest && (biggest.trade.offering.length + biggest.trade.requesting.length) >= 2) {
    const teams = teamsPerLeague[biggest.leagueId] ?? [];
    const a = teams.find(t => t.id === biggest.trade.proposerId);
    const b = teams.find(t => t.id === biggest.trade.recipientId);
    if (a && b) {
      out.push({
        kind: 'trade',
        leagueId: biggest.leagueId,
        teamA: a.teamAbbrev,
        teamB: b.teamAbbrev,
        pokemonCount: biggest.trade.offering.length + biggest.trade.requesting.length,
        timestamp: biggest.trade.proposedAt ?? '',
      });
    }
  }

  return out.slice(0, MAX_HEADLINES);
}
