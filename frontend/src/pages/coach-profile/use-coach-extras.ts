import { useEffect, useState } from 'react';
import { api, type ApiPublicProfile } from '@/lib/api';

/** A single completed match outcome for the coach, oldest → newest. */
export interface CoachResult {
  matchId: string;
  leagueId: string;
  week: number;
  result: 'W' | 'L';
  /** Margin in score (positive on a win, negative on a loss). */
  diff: number;
}

export interface CoachExtras {
  loading: boolean;
  /** Completed match results across all currently-managed leagues, oldest first. */
  results: CoachResult[];
}

/**
 * Aggregates completed-match results across the coach's currently-managed
 * leagues for the win-rate sparkline panel on the coach-profile page.
 * Uses only existing endpoints (`getSchedule` per current league); no new
 * backend work.
 */
export function useCoachExtras(profile: ApiPublicProfile | null): CoachExtras {
  const [results, setResults] = useState<CoachResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }

    const teams = profile.currentTeams;
    if (teams.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Fetch schedule data for every league the coach is in, in parallel.
    // Failures per-league are swallowed so a single broken league doesn't
    // blank the whole profile.
    const work = teams.map(async t => {
      const sched = await api.getSchedule(t.leagueId).catch(() => ({ matches: [], byes: [] }));
      return { tenure: t, schedule: sched };
    });

    Promise.all(work).then(perLeague => {
      if (cancelled) return;

      // Results timeline
      // Flatten completed matches into per-coach W/L outcomes, ordered
      // by week ascending (oldest first) so the polyline reads left → right.
      const flat: CoachResult[] = [];
      for (const { tenure, schedule } of perLeague) {
        for (const m of schedule.matches) {
          if (m.status !== 'completed') continue;
          if (m.homeScore == null || m.awayScore == null) continue;
          const isHome = m.homePlayer === tenure.teamId;
          const isAway = m.awayPlayer === tenure.teamId;
          if (!isHome && !isAway) continue;
          const myScore = isHome ? m.homeScore : m.awayScore;
          const oppScore = isHome ? m.awayScore : m.homeScore;
          if (myScore === oppScore) continue; // ties don't move the win-rate
          flat.push({
            matchId: m.id,
            leagueId: tenure.leagueId,
            week: m.week,
            result: myScore > oppScore ? 'W' : 'L',
            diff: myScore - oppScore,
          });
        }
      }
      // Sort by week ascending (no per-match timestamp on ApiMatch, so
      // week + leagueId is the best stable order). Within a week, league
      // id is just stable, not meaningful — fine for a sparkline.
      flat.sort((a, b) => a.week - b.week || a.leagueId.localeCompare(b.leagueId));
      setResults(flat);

      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [profile]);

  return { loading, results };
}
