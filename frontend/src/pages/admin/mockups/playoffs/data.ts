// Static fake data for the playoff approval mockup. No API calls.
export interface MockTeam {
  id: string; name: string; abbrev: string; color: string; coach: string;
  w: number; l: number; diff: number; division: string;
  /** Plain-language tiebreak note shown on the seed's standings chip. */
  tiebreak?: string;
}

export const TEAMS: MockTeam[] = [
  { id: 't1', name: 'Gale Force', abbrev: 'GAL', color: '#38bdf8', coach: 'Avery', w: 10, l: 2, diff: 14, division: 'East' },
  { id: 't2', name: 'Moss Rollers', abbrev: 'MOS', color: '#4ade80', coach: 'Bex', w: 9, l: 3, diff: 11, division: 'West' },
  { id: 't3', name: 'Ember Court', abbrev: 'EMB', color: '#fb923c', coach: 'Cass', w: 8, l: 4, diff: 9, division: 'East', tiebreak: 'Tied 8-4 with Tidal Lock; won H2H 2-1' },
  { id: 't4', name: 'Tidal Lock', abbrev: 'TID', color: '#60a5fa', coach: 'Dune', w: 8, l: 4, diff: 6, division: 'East', tiebreak: 'Tied 8-4 with Ember Court; lost H2H 1-2' },
  { id: 't5', name: 'Voltage Fox', abbrev: 'VOL', color: '#facc15', coach: 'Eli', w: 7, l: 5, diff: 3, division: 'West' },
  { id: 't6', name: 'Night Shift', abbrev: 'NSH', color: '#a78bfa', coach: 'Fen', w: 6, l: 6, diff: 1, division: 'West', tiebreak: 'Tied 6-6 with Iron Bloom; +1 diff vs 0' },
  { id: 't7', name: 'Iron Bloom', abbrev: 'IRB', color: '#f472b6', coach: 'Gus', w: 6, l: 6, diff: 0, division: 'East', tiebreak: 'Tied 6-6 with Night Shift; lost on diff' },
  { id: 't8', name: 'Dusk Pilots', abbrev: 'DSK', color: '#94a3b8', coach: 'Hana', w: 4, l: 8, diff: -7, division: 'West' },
  { id: 't9', name: 'Salt Flats', abbrev: 'SLT', color: '#f87171', coach: 'Ivo', w: 3, l: 9, diff: -14, division: 'East' },
  { id: 't10', name: 'Pebble Gang', abbrev: 'PEB', color: '#2dd4bf', coach: 'Jo', w: 2, l: 10, diff: -23, division: 'West' },
];
export const TEAM_BY_ID = new Map(TEAMS.map(t => [t.id, t]));
export const STANDINGS = TEAMS.map(t => t.id);
export const TOP_N = 6;
export const LEAGUE_NAME = 'Season 12 - Emerald';
/** Regular-season pairs already met twice (flagged as a rematch in round 1). */
export const PLAYED_TWICE = new Set(['t3|t6', 't4|t5']);
export const pairKey = (a: string, b: string) => [a, b].sort().join('|');
export const PLAYOFF_WEEK = 8; // QF week; SF 9; F 10
