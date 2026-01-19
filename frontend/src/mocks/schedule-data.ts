import type { Match } from '@/lib/types';

/**
 * Raw season schedule — 12 teams, 11 weeks, 6 matches per week.
 * Weeks 1-9 have scores, weeks 10-11 are upcoming.
 *
 * This file has no imports from match-details to avoid circular deps.
 */
export const rawMatches: Match[] = [
  // Week 1
  { id: 'w1m1', week: 1, homePlayer: 'sas', awayPlayer: 'gg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w1m2', week: 1, homePlayer: 'llb', awayPlayer: 'pow', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w1m3', week: 1, homePlayer: 'vvv', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w1m4', week: 1, homePlayer: 'gwg', awayPlayer: 'fam', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w1m5', week: 1, homePlayer: 'dwg', awayPlayer: 'ece', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w1m6', week: 1, homePlayer: 'ak', awayPlayer: 'mgm', homeScore: 0, awayScore: 1, replayUrl: '#' },

  // Week 2
  { id: 'w2m1', week: 2, homePlayer: 'sas', awayPlayer: 'ak', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w2m2', week: 2, homePlayer: 'llb', awayPlayer: 'gwg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w2m3', week: 2, homePlayer: 'vvv', awayPlayer: 'dwg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w2m4', week: 2, homePlayer: 'mgm', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w2m5', week: 2, homePlayer: 'fam', awayPlayer: 'pow', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w2m6', week: 2, homePlayer: 'ece', awayPlayer: 'gg', homeScore: 0, awayScore: 1, replayUrl: '#' },

  // Week 3
  { id: 'w3m1', week: 3, homePlayer: 'sas', awayPlayer: 'llb', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w3m2', week: 3, homePlayer: 'vvv', awayPlayer: 'mgm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w3m3', week: 3, homePlayer: 'gwg', awayPlayer: 'dwg', homeScore: 0, awayScore: 1, replayUrl: '#' },
  { id: 'w3m4', week: 3, homePlayer: 'ak', awayPlayer: 'fam', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w3m5', week: 3, homePlayer: 'ece', awayPlayer: 'pow', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w3m6', week: 3, homePlayer: 'gg', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },

  // Week 4
  { id: 'w4m1', week: 4, homePlayer: 'sas', awayPlayer: 'vvv', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w4m2', week: 4, homePlayer: 'llb', awayPlayer: 'mgm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w4m3', week: 4, homePlayer: 'gwg', awayPlayer: 'ak', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w4m4', week: 4, homePlayer: 'dwg', awayPlayer: 'fam', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w4m5', week: 4, homePlayer: 'ece', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w4m6', week: 4, homePlayer: 'gg', awayPlayer: 'pow', homeScore: 0, awayScore: 1, replayUrl: '#' },

  // Week 5
  { id: 'w5m1', week: 5, homePlayer: 'sas', awayPlayer: 'gwg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w5m2', week: 5, homePlayer: 'llb', awayPlayer: 'dwg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w5m3', week: 5, homePlayer: 'vvv', awayPlayer: 'ak', homeScore: 0, awayScore: 1, replayUrl: '#' },
  { id: 'w5m4', week: 5, homePlayer: 'mgm', awayPlayer: 'fam', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w5m5', week: 5, homePlayer: 'ece', awayPlayer: 'gg', homeScore: 0, awayScore: 1, replayUrl: '#' },
  { id: 'w5m6', week: 5, homePlayer: 'pow', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },

  // Week 6
  { id: 'w6m1', week: 6, homePlayer: 'sas', awayPlayer: 'mgm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w6m2', week: 6, homePlayer: 'llb', awayPlayer: 'ak', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w6m3', week: 6, homePlayer: 'vvv', awayPlayer: 'fam', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w6m4', week: 6, homePlayer: 'gwg', awayPlayer: 'ece', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w6m5', week: 6, homePlayer: 'dwg', awayPlayer: 'gg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w6m6', week: 6, homePlayer: 'hmm', awayPlayer: 'pow', homeScore: 0, awayScore: 1, replayUrl: '#' },

  // Week 7
  { id: 'w7m1', week: 7, homePlayer: 'sas', awayPlayer: 'fam', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w7m2', week: 7, homePlayer: 'llb', awayPlayer: 'ece', homeScore: 0, awayScore: 1, replayUrl: '#' },
  { id: 'w7m3', week: 7, homePlayer: 'vvv', awayPlayer: 'gg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w7m4', week: 7, homePlayer: 'gwg', awayPlayer: 'pow', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w7m5', week: 7, homePlayer: 'dwg', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w7m6', week: 7, homePlayer: 'ak', awayPlayer: 'mgm', homeScore: 1, awayScore: 0, replayUrl: '#' },

  // Week 8
  { id: 'w8m1', week: 8, homePlayer: 'sas', awayPlayer: 'ece', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w8m2', week: 8, homePlayer: 'llb', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w8m3', week: 8, homePlayer: 'vvv', awayPlayer: 'pow', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w8m4', week: 8, homePlayer: 'gwg', awayPlayer: 'mgm', homeScore: 0, awayScore: 1, replayUrl: '#' },
  { id: 'w8m5', week: 8, homePlayer: 'dwg', awayPlayer: 'ak', homeScore: 0, awayScore: 1, replayUrl: '#' },
  { id: 'w8m6', week: 8, homePlayer: 'fam', awayPlayer: 'gg', homeScore: 1, awayScore: 0, replayUrl: '#' },

  // Week 9 (most recent)
  { id: 'w9m1', week: 9, homePlayer: 'sas', awayPlayer: 'dwg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w9m2', week: 9, homePlayer: 'llb', awayPlayer: 'ece', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w9m3', week: 9, homePlayer: 'vvv', awayPlayer: 'gg', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w9m4', week: 9, homePlayer: 'gwg', awayPlayer: 'hmm', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w9m5', week: 9, homePlayer: 'ak', awayPlayer: 'pow', homeScore: 1, awayScore: 0, replayUrl: '#' },
  { id: 'w9m6', week: 9, homePlayer: 'fam', awayPlayer: 'mgm', homeScore: 0, awayScore: 1, replayUrl: '#' },

  // Week 10 (upcoming)
  { id: 'w10m1', week: 10, homePlayer: 'sas', awayPlayer: 'llb' },
  { id: 'w10m2', week: 10, homePlayer: 'vvv', awayPlayer: 'gwg' },
  { id: 'w10m3', week: 10, homePlayer: 'dwg', awayPlayer: 'ak' },
  { id: 'w10m4', week: 10, homePlayer: 'mgm', awayPlayer: 'ece' },
  { id: 'w10m5', week: 10, homePlayer: 'fam', awayPlayer: 'gg' },
  { id: 'w10m6', week: 10, homePlayer: 'pow', awayPlayer: 'hmm' },

  // Week 11 (upcoming)
  { id: 'w11m1', week: 11, homePlayer: 'sas', awayPlayer: 'hmm' },
  { id: 'w11m2', week: 11, homePlayer: 'llb', awayPlayer: 'fam' },
  { id: 'w11m3', week: 11, homePlayer: 'vvv', awayPlayer: 'ece' },
  { id: 'w11m4', week: 11, homePlayer: 'gwg', awayPlayer: 'gg' },
  { id: 'w11m5', week: 11, homePlayer: 'dwg', awayPlayer: 'mgm' },
  { id: 'w11m6', week: 11, homePlayer: 'ak', awayPlayer: 'pow' },
];
