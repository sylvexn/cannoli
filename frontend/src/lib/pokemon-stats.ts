import type { PokemonType } from './pokemon';
import type { Player } from './types';

export interface PokemonLeagueStat {
  name: string;
  teamId: string;
  types: PokemonType[];
  tier: number;
  kills: number;
  deaths: number;
  differential: number;
  gp: number;
  kpg: number;
  record: { wins: number; losses: number };
  isTeraCaptain: boolean;
  /** Played for the team but is no longer on its roster. */
  departed?: boolean;
}

/**
 * Build league stats from player rosters plus departed mons.
 * Uses season stats already computed by the backend (from match_pokemon).
 */
export function computeLeagueStats(players: Player[]): PokemonLeagueStat[] {
  const stats: PokemonLeagueStat[] = [];

  for (const player of players) {
    for (const mon of player.roster) {
      const kills = mon.seasonStats.kills;
      const deaths = mon.seasonStats.deaths;
      const gp = mon.seasonStats.gp;

      stats.push({
        name: mon.name,
        teamId: player.id,
        types: mon.types,
        tier: mon.tier,
        kills,
        deaths,
        differential: kills - deaths,
        gp,
        kpg: gp > 0 ? Math.round((kills / gp) * 100) / 100 : 0,
        record: { wins: mon.seasonStats.wins ?? 0, losses: mon.seasonStats.losses ?? 0 },
        isTeraCaptain: mon.isTeraCaptain,
      });
    }
    for (const mon of player.departed ?? []) {
      const { kills, deaths, gp, wins, losses } = mon.seasonStats;
      stats.push({
        name: mon.name,
        teamId: player.id,
        types: mon.types,
        tier: mon.tier,
        kills,
        deaths,
        differential: kills - deaths,
        gp,
        kpg: gp > 0 ? Math.round((kills / gp) * 100) / 100 : 0,
        record: { wins, losses },
        isTeraCaptain: false,
        departed: true,
      });
    }
  }

  return stats;
}
