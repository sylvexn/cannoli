import type { LeagueSeason, Match } from '@/lib/types';

export const currentSeason: LeagueSeason = {
  id: 's10',
  seasonNumber: 10,
  phase: 'regular',
  currentWeek: 9,
  totalWeeks: 11,
};

// Subset of matches for the most recent week
export const recentMatches: Match[] = [
  { id: 'm1', week: 9, homePlayer: 'sas', awayPlayer: 'dwg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'm2', week: 9, homePlayer: 'llb', awayPlayer: 'ece', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'm3', week: 9, homePlayer: 'vvv', awayPlayer: 'gg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'm4', week: 9, homePlayer: 'gwg', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'm5', week: 9, homePlayer: 'ak', awayPlayer: 'pow', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'm6', week: 9, homePlayer: 'fam', awayPlayer: 'mgm', homeScore: 0, awayScore: 1, replayUrl: '#' },
];

// Upcoming week
export const upcomingMatches: Match[] = [
  { id: 'u1', week: 10, homePlayer: 'sas', awayPlayer: 'llb' },
  { id: 'u2', week: 10, homePlayer: 'vvv', awayPlayer: 'gwg' },
  { id: 'u3', week: 10, homePlayer: 'dwg', awayPlayer: 'ak' },
  { id: 'u4', week: 10, homePlayer: 'mgm', awayPlayer: 'ece' },
  { id: 'u5', week: 10, homePlayer: 'fam', awayPlayer: 'gg' },
  { id: 'u6', week: 10, homePlayer: 'pow', awayPlayer: 'hmm' },
];
