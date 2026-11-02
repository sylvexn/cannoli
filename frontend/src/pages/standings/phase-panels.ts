import type { LeagueSeason, Match } from '@/lib/types';

/** Which Overview / Home panel a season phase calls for. */
export type PanelKind = 'draft' | 'regular' | 'playoffs' | 'complete';

export function panelFor(season: Pick<LeagueSeason, 'phase' | 'archived'>): PanelKind {
  if (season.archived || season.phase === 'offseason') return 'complete';
  if (season.phase === 'predraft' || season.phase === 'draft') return 'draft';
  return season.phase === 'playoffs' ? 'playoffs' : 'regular';
}

const isPlayed = (m: Match) => m.status === 'completed' || m.homeScore != null;

/** Latest regular-season week at or before `from` that has a played fixture (0 = none). */
export function lastPlayedWeek(matches: Match[], from: number): number {
  let best = 0;
  for (const m of matches) {
    if (m.phase !== 'playoffs' && m.week <= from && m.week > best && isPlayed(m)) best = m.week;
  }
  return best;
}

/** Winner team id of the finals, or null until a final has a decisive score. */
export function championId(matches: Match[]): string | null {
  const f = matches.find(m => m.phase === 'playoffs' && m.playoffRound === 'f' && m.homeScore != null && m.awayScore != null);
  if (!f || f.homeScore === f.awayScore) return null;
  return f.homeScore! > f.awayScore! ? f.homePlayer : f.awayPlayer;
}

/** The coach's unplayed playoff fixture, if any. */
export function myPlayoffMatch(matches: Match[], teamId: string): Match | undefined {
  return matches.find(m => m.phase === 'playoffs' && !isPlayed(m) && (m.homePlayer === teamId || m.awayPlayer === teamId));
}
