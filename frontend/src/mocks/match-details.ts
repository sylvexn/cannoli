/**
 * Per-match Pokemon KD data — generated to be consistent with season totals.
 *
 * Rules:
 * - Each team brings 6 of 10 roster Pokemon per match
 * - Winner KOs all 6 opponent Pokemon (loser deaths = 6)
 * - Loser KOs 0-5 of winner's Pokemon (winner deaths = 0-5)
 * - Each Pokemon's total kills/deaths/gp across all matches ≈ their seasonStats
 * - 0-1 tera usage per team per match (tera captains preferred)
 */

import type { MatchPokemonEntry } from '@/lib/types';
import { players } from './players';
import { allMatches } from './season';

// Seeded RNG for deterministic generation
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

interface MatchDetail {
  matchId: string;
  home: MatchPokemonEntry[];
  away: MatchPokemonEntry[];
}

function generateAllMatchDetails(): MatchDetail[] {
  const rng = seededRng(42);
  const playerMap = new Map(players.map(p => [p.id, p]));

  // Step 1: For each team, assign which weeks each Pokemon appears in
  // Each Pokemon needs exactly `gp` appearances across their team's matches
  const teamAppearances = new Map<string, Map<string, Set<number>>>();

  for (const player of players) {
    const pokemonWeeks = new Map<string, Set<number>>();

    // Get all weeks this team plays (completed only, weeks 1-9)
    const teamMatches = allMatches
      .filter(m => m.week <= 9 && (m.homePlayer === player.id || m.awayPlayer === player.id))
      .map(m => m.week);

    // Sort roster by gp descending so high-gp mons get first pick of weeks
    const sorted = [...player.roster].sort((a, b) => b.seasonStats.gp - a.seasonStats.gp);

    // Track how many Pokemon are assigned to each week (need exactly 6)
    const weekCounts = new Map<number, number>();
    for (const w of teamMatches) weekCounts.set(w, 0);

    for (const mon of sorted) {
      const needed = Math.min(mon.seasonStats.gp, teamMatches.length);
      const available = teamMatches
        .filter(w => (weekCounts.get(w) ?? 0) < 6)
        .sort((a, b) => (weekCounts.get(a) ?? 0) - (weekCounts.get(b) ?? 0));

      const assigned = new Set<number>();
      // Pick weeks with fewest assigned Pokemon first
      for (const w of available) {
        if (assigned.size >= needed) break;
        assigned.add(w);
      }

      // If we couldn't assign enough, that's OK — we'll adjust gp later
      pokemonWeeks.set(mon.name, assigned);
      for (const w of assigned) {
        weekCounts.set(w, (weekCounts.get(w) ?? 0) + 1);
      }
    }

    // Fix: ensure exactly 6 per week
    for (const week of teamMatches) {
      const count = weekCounts.get(week) ?? 0;
      if (count < 6) {
        // Add more Pokemon to this week
        for (const mon of sorted) {
          if (count >= 6) break;
          const weeks = pokemonWeeks.get(mon.name)!;
          if (!weeks.has(week)) {
            weeks.add(week);
            weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
          }
          if ((weekCounts.get(week) ?? 0) >= 6) break;
        }
      } else if (count > 6) {
        // Remove excess — remove from lowest-gp Pokemon
        const reverseSorted = [...sorted].reverse();
        for (const mon of reverseSorted) {
          if ((weekCounts.get(week) ?? 0) <= 6) break;
          const weeks = pokemonWeeks.get(mon.name)!;
          if (weeks.has(week) && weeks.size > 1) {
            weeks.delete(week);
            weekCounts.set(week, (weekCounts.get(week) ?? 0) - 1);
          }
        }
      }
    }

    teamAppearances.set(player.id, pokemonWeeks);
  }

  // Step 2: For each completed match, generate KD data
  const details: MatchDetail[] = [];

  // Track running totals to distribute kills/deaths
  const killBudget = new Map<string, Map<string, number>>(); // teamId -> monName -> remaining kills
  const deathBudget = new Map<string, Map<string, number>>();

  for (const player of players) {
    const kills = new Map<string, number>();
    const deaths = new Map<string, number>();
    for (const mon of player.roster) {
      kills.set(mon.name, mon.seasonStats.kills);
      deaths.set(mon.name, mon.seasonStats.deaths);
    }
    killBudget.set(player.id, kills);
    deathBudget.set(player.id, deaths);
  }

  // Track remaining matches per pokemon for budget distribution
  const remainingGames = new Map<string, Map<string, number>>();
  for (const player of players) {
    const remaining = new Map<string, number>();
    const pokemonWeeks = teamAppearances.get(player.id)!;
    for (const mon of player.roster) {
      remaining.set(mon.name, pokemonWeeks.get(mon.name)?.size ?? 0);
    }
    remainingGames.set(player.id, remaining);
  }

  const completedMatches = allMatches.filter(m => m.homeScore !== undefined && m.week <= 9);

  for (const match of completedMatches) {
    const homePlayer = playerMap.get(match.homePlayer)!;
    const awayPlayer = playerMap.get(match.awayPlayer)!;

    const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
    const winner = homeWon ? homePlayer : awayPlayer;
    const loser = homeWon ? awayPlayer : homePlayer;
    const winnerId = winner.id;
    const loserId = loser.id;

    // Get the 6 Pokemon each side brought this week
    const homeWeeks = teamAppearances.get(match.homePlayer)!;
    const awayWeeks = teamAppearances.get(match.awayPlayer)!;

    const homeBrought = homePlayer.roster.filter(m => homeWeeks.get(m.name)?.has(match.week));
    const awayBrought = awayPlayer.roster.filter(m => awayWeeks.get(m.name)?.has(match.week));

    // Ensure exactly 6 each (pad or trim if needed)
    while (homeBrought.length < 6) {
      const extra = homePlayer.roster.find(m => !homeBrought.includes(m));
      if (extra) homeBrought.push(extra);
      else break;
    }
    while (awayBrought.length < 6) {
      const extra = awayPlayer.roster.find(m => !awayBrought.includes(m));
      if (extra) awayBrought.push(extra);
      else break;
    }

    // Winner kills = 6 (all opponent mons faint)
    // Loser deaths = 6
    // Winner deaths = loser kills = 1-5 (random, based on how close the match was)
    const winnerDeaths = Math.floor(rng() * 4) + 1; // 1-4 deaths for winner
    const loserKills = winnerDeaths;

    // Distribute winner's 6 kills among their 6 Pokemon
    const winnerBrought = homeWon ? homeBrought : awayBrought;
    const loserBrought = homeWon ? awayBrought : homeBrought;

    const winnerKillBudget = killBudget.get(winnerId)!;
    const winnerDeathBudget = deathBudget.get(winnerId)!;
    const loserKillBudget = killBudget.get(loserId)!;
    const loserDeathBudget = deathBudget.get(loserId)!;

    const winnerRemaining = remainingGames.get(winnerId)!;
    const loserRemaining = remainingGames.get(loserId)!;

    // Distribute kills proportionally to remaining kill budget
    function distributeKills(brought: typeof winnerBrought, totalKills: number, budget: Map<string, number>, remaining: Map<string, number>): number[] {
      const weights = brought.map(m => {
        const rem = remaining.get(m.name) ?? 1;
        const budgetLeft = budget.get(m.name) ?? 0;
        return rem > 0 ? budgetLeft / rem : 0;
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0);

      const kills = new Array(brought.length).fill(0);
      let remaining_kills = totalKills;

      if (totalWeight > 0) {
        // First pass: proportional
        for (let i = 0; i < brought.length; i++) {
          const expected = (weights[i] / totalWeight) * totalKills;
          kills[i] = Math.floor(expected);
          remaining_kills -= kills[i];
        }
      }

      // Distribute remaining kills randomly
      while (remaining_kills > 0) {
        const idx = Math.floor(rng() * brought.length);
        kills[idx]++;
        remaining_kills--;
      }

      return kills;
    }

    function distributeDeaths(brought: typeof winnerBrought, totalDeaths: number, budget: Map<string, number>, remaining: Map<string, number>): number[] {
      // For loser (totalDeaths=6): all faint, so each gets 1 death, distribute remaining 0
      if (totalDeaths === brought.length) {
        return new Array(brought.length).fill(1);
      }

      // For winner: distribute deaths among some of them
      const deaths = new Array(brought.length).fill(0);
      let rem = totalDeaths;

      // Weight by death budget
      const indices = brought.map((_, i) => i).sort(() => rng() - 0.5);
      for (const idx of indices) {
        if (rem <= 0) break;
        const budgetLeft = budget.get(brought[idx].name) ?? 0;
        const gamesLeft = remaining.get(brought[idx].name) ?? 1;
        if (budgetLeft > 0 && rng() < budgetLeft / gamesLeft) {
          deaths[idx] = 1;
          rem--;
        }
      }

      // Force remaining deaths
      while (rem > 0) {
        const idx = Math.floor(rng() * brought.length);
        if (deaths[idx] === 0) {
          deaths[idx] = 1;
          rem--;
        }
      }

      return deaths;
    }

    const winnerKills = distributeKills(winnerBrought, 6, winnerKillBudget, winnerRemaining);
    const winnerDeathsArr = distributeDeaths(winnerBrought, winnerDeaths, winnerDeathBudget, winnerRemaining);
    const loserKillsArr = distributeKills(loserBrought, loserKills, loserKillBudget, loserRemaining);
    const loserDeathsArr = distributeDeaths(loserBrought, 6, loserDeathBudget, loserRemaining);

    // Update budgets
    for (let i = 0; i < winnerBrought.length; i++) {
      const name = winnerBrought[i].name;
      winnerKillBudget.set(name, (winnerKillBudget.get(name) ?? 0) - winnerKills[i]);
      winnerDeathBudget.set(name, (winnerDeathBudget.get(name) ?? 0) - winnerDeathsArr[i]);
      winnerRemaining.set(name, (winnerRemaining.get(name) ?? 1) - 1);
    }
    for (let i = 0; i < loserBrought.length; i++) {
      const name = loserBrought[i].name;
      loserKillBudget.set(name, (loserKillBudget.get(name) ?? 0) - loserKillsArr[i]);
      loserDeathBudget.set(name, (loserDeathBudget.get(name) ?? 0) - loserDeathsArr[i]);
      loserRemaining.set(name, (loserRemaining.get(name) ?? 1) - 1);
    }

    // Tera usage: 0-1 per team, prefer tera captains
    function pickTera(brought: typeof winnerBrought): boolean[] {
      const result = new Array(brought.length).fill(false);
      if (rng() < 0.7) { // 70% chance someone teras
        const captainIdx = brought.findIndex(m => m.isTeraCaptain);
        if (captainIdx >= 0) {
          result[captainIdx] = true;
        } else {
          result[Math.floor(rng() * brought.length)] = true;
        }
      }
      return result;
    }

    const winnerTera = pickTera(winnerBrought);
    const loserTera = pickTera(loserBrought);

    // Build entries
    function buildEntries(brought: typeof winnerBrought, kills: number[], deaths: number[], tera: boolean[]): MatchPokemonEntry[] {
      return brought.slice(0, 6).map((mon, i) => ({
        name: mon.name,
        kills: Math.max(0, kills[i]),
        deaths: Math.max(0, deaths[i]),
        teraUsed: tera[i],
      }));
    }

    const homeEntries = homeWon
      ? buildEntries(winnerBrought, winnerKills, winnerDeathsArr, winnerTera)
      : buildEntries(loserBrought, loserKillsArr, loserDeathsArr, loserTera);
    const awayEntries = homeWon
      ? buildEntries(loserBrought, loserKillsArr, loserDeathsArr, loserTera)
      : buildEntries(winnerBrought, winnerKills, winnerDeathsArr, winnerTera);

    details.push({
      matchId: match.id,
      home: homeEntries,
      away: awayEntries,
    });
  }

  return details;
}

// Generate once and cache
const allMatchDetails = generateAllMatchDetails();

/** Map of matchId -> { home, away } Pokemon entries */
export const matchDetailMap = new Map(
  allMatchDetails.map(d => [d.matchId, { home: d.home, away: d.away }])
);

/** Get Pokemon KD entries for a specific match */
export function getMatchDetail(matchId: string) {
  return matchDetailMap.get(matchId);
}

/**
 * Compute actual season stats from the generated match data.
 * Use this to keep seasonStats in sync with per-match data.
 */
export function computeSeasonStats(teamId: string): Map<string, { kills: number; deaths: number; gp: number }> {
  const stats = new Map<string, { kills: number; deaths: number; gp: number }>();

  for (const [matchId, detail] of matchDetailMap) {
    const match = allMatches.find(m => m.id === matchId);
    if (!match) continue;

    const isHome = match.homePlayer === teamId;
    const isAway = match.awayPlayer === teamId;
    if (!isHome && !isAway) continue;

    const entries = isHome ? detail.home : detail.away;
    for (const entry of entries) {
      const existing = stats.get(entry.name) ?? { kills: 0, deaths: 0, gp: 0 };
      existing.kills += entry.kills;
      existing.deaths += entry.deaths;
      existing.gp += 1;
      stats.set(entry.name, existing);
    }
  }

  return stats;
}
