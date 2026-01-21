import type { League } from '@/lib/types';
import { players } from './players';
import { currentSeason } from './season';

export const leagues: League[] = [
  {
    id: 'sapphire',
    name: 'Sapphire League',
    color: '#2563eb',
    season: currentSeason,
    players,
    hasData: true,
  },
  {
    id: 'ruby',
    name: 'Ruby League',
    color: '#dc2626',
    season: {
      id: 's10-ruby',
      seasonNumber: 10,
      phase: 'regular',
      currentWeek: 8,
      totalWeeks: 11,
    },
    players: [],
    hasData: false,
  },
  {
    id: 'emerald',
    name: 'Emerald League',
    color: '#16a34a',
    season: {
      id: 's10-emerald',
      seasonNumber: 10,
      phase: 'draft',
      currentWeek: 0,
      totalWeeks: 11,
    },
    players: [],
    hasData: false,
  },
];

export const leagueMap = new Map(leagues.map(l => [l.id, l]));

export function getLeague(id: string): League | undefined {
  return leagueMap.get(id);
}
