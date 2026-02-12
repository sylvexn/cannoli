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
}

/**
 * Build league stats from player rosters.
 * Uses season stats already computed by the backend and attached to roster entries.
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
        record: { wins: 0, losses: 0 }, // Win/loss per pokemon not tracked in API yet
        isTeraCaptain: mon.isTeraCaptain,
      });
    }
  }

  return stats;
}
