import type { PokemonType } from './pokemon';
import { players } from '@/mocks/players';
import { rawMatches } from '@/mocks/schedule-data';
import { matchDetailMap } from '@/mocks/match-details';

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

export function computeLeagueStats(): PokemonLeagueStat[] {
  const completedMatches = rawMatches.filter(m => m.homeScore !== undefined && m.week <= 9);

  // Build appearance records: for each player's Pokemon, track which matches they appeared in
  // and whether the team won or lost
  const appearanceRecords = new Map<string, { wins: number; losses: number; kills: number; deaths: number; gp: number }>();

  for (const match of completedMatches) {
    const detail = matchDetailMap.get(match.id);
    if (!detail) continue;

    const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);

    // Process home side
    for (const entry of detail.home) {
      const key = `${match.homePlayer}:${entry.name}`;
      const rec = appearanceRecords.get(key) ?? { wins: 0, losses: 0, kills: 0, deaths: 0, gp: 0 };
      rec.gp++;
      rec.kills += entry.kills;
      rec.deaths += entry.deaths;
      if (homeWon) rec.wins++;
      else rec.losses++;
      appearanceRecords.set(key, rec);
    }

    // Process away side
    for (const entry of detail.away) {
      const key = `${match.awayPlayer}:${entry.name}`;
      const rec = appearanceRecords.get(key) ?? { wins: 0, losses: 0, kills: 0, deaths: 0, gp: 0 };
      rec.gp++;
      rec.kills += entry.kills;
      rec.deaths += entry.deaths;
      if (!homeWon) rec.wins++;
      else rec.losses++;
      appearanceRecords.set(key, rec);
    }
  }

  // Build stats for all 120 Pokemon
  const stats: PokemonLeagueStat[] = [];

  for (const player of players) {
    for (const mon of player.roster) {
      const key = `${player.id}:${mon.name}`;
      const rec = appearanceRecords.get(key);

      const kills = rec?.kills ?? mon.seasonStats.kills;
      const deaths = rec?.deaths ?? mon.seasonStats.deaths;
      const gp = rec?.gp ?? mon.seasonStats.gp;

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
        record: rec ? { wins: rec.wins, losses: rec.losses } : { wins: 0, losses: 0 },
        isTeraCaptain: mon.isTeraCaptain,
      });
    }
  }

  return stats;
}
