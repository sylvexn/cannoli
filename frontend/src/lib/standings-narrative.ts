import { Flame, Snowflake, Target, Skull, type LucideIcon } from 'lucide-react';
import type { Player, Match } from '@/lib/types';

export interface StandingsChip {
  kind: 'streak-win' | 'streak-loss' | 'clinched' | 'eliminated';
  label: string;
  icon: LucideIcon;
  /** Tailwind text color class */
  textClass: string;
  /** Tailwind bg color class (10–15% opacity) */
  bgClass: string;
}

/**
 * Compute a single narrative chip for a standings row, or null if no chip
 * is meaningful for this team right now. Only the most-pressing chip is
 * returned — restrained by design.
 *
 * Priority: clinched > eliminated > streak (≥2 in either direction).
 */
export function getStandingsNarrative(
  team: Player,
  ctx: {
    rank: number;
    standings: Player[];
    teamMatches: Match[];
    /** Total scheduled regular-season weeks for this league */
    totalRegularWeeks: number;
    /** How many seeds make playoffs */
    playoffSize: number;
    /** Current week number */
    currentWeek: number;
  },
): StandingsChip | null {
  const { rank, standings, teamMatches, totalRegularWeeks, playoffSize, currentWeek } = ctx;

  // Walk completed matches for this team, gather W/L sequence in chronological order
  const results = teamMatches
    .filter(m => m.phase === 'regular' && m.homeScore !== undefined && m.awayScore !== undefined)
    .sort((a, b) => a.week - b.week)
    .map(m => {
      const isHome = m.homePlayer === team.id;
      const myScore = isHome ? m.homeScore! : m.awayScore!;
      const oppScore = isHome ? m.awayScore! : m.homeScore!;
      if (myScore > oppScore) return 'W' as const;
      if (myScore < oppScore) return 'L' as const;
      return 'D' as const;
    });

  // Clinched / eliminated take priority — only relevant late in the season
  if (currentWeek >= Math.max(2, Math.floor(totalRegularWeeks * 0.6))) {
    const status = computeClinchStatus({ team, rank, standings, totalRegularWeeks, playoffSize });
    if (status === 'clinched') {
      return {
        kind: 'clinched',
        label: 'Clinched',
        icon: Target,
        textClass: 'text-win',
        bgClass: 'bg-win/15',
      };
    }
    if (status === 'eliminated') {
      return {
        kind: 'eliminated',
        label: 'Out',
        icon: Skull,
        textClass: 'text-loss',
        bgClass: 'bg-loss/15',
      };
    }
  }

  // Streak — only meaningful at ≥2
  let streak = 0;
  let streakKind: 'W' | 'L' | null = null;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (r === 'D') break;
    if (streakKind === null) {
      streakKind = r;
      streak = 1;
    } else if (r === streakKind) {
      streak++;
    } else {
      break;
    }
  }

  if (streak >= 2 && streakKind === 'W') {
    return {
      kind: 'streak-win',
      label: `W${streak}`,
      icon: Flame,
      textClass: 'text-orange-400',
      bgClass: 'bg-orange-400/15',
    };
  }
  if (streak >= 2 && streakKind === 'L') {
    return {
      kind: 'streak-loss',
      label: `L${streak}`,
      icon: Snowflake,
      textClass: 'text-cyan-300',
      bgClass: 'bg-cyan-300/15',
    };
  }

  return null;
}

function computeClinchStatus({
  team,
  rank,
  standings,
  totalRegularWeeks,
  playoffSize,
}: {
  team: Player;
  rank: number;
  standings: Player[];
  totalRegularWeeks: number;
  playoffSize: number;
}): 'clinched' | 'eliminated' | null {
  const myGamesPlayed = team.record.wins + team.record.losses;
  const myRemaining = Math.max(0, totalRegularWeeks - myGamesPlayed);
  const myMaxWins = team.record.wins + myRemaining;

  // Eliminated: cannot reach the current playoff cut team's wins
  if (rank > playoffSize) {
    const cutTeam = standings[playoffSize - 1];
    if (cutTeam && myMaxWins < cutTeam.record.wins) {
      return 'eliminated';
    }
  }

  // Clinched: every team currently outside top-N cannot reach my wins
  if (rank <= playoffSize) {
    const outsiders = standings.slice(playoffSize);
    const allOutsidersCantCatchUp = outsiders.every(o => {
      const oGamesPlayed = o.record.wins + o.record.losses;
      const oRemaining = Math.max(0, totalRegularWeeks - oGamesPlayed);
      return o.record.wins + oRemaining < team.record.wins;
    });
    if (allOutsidersCantCatchUp && outsiders.length > 0) {
      return 'clinched';
    }
  }

  return null;
}
