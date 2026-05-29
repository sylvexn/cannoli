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

/** A pokemon that's appeared on one or more of the coach's rosters. */
export interface SignatureMon {
  name: string;
  isShiny: boolean;
  /** Number of distinct (league, team) tenures this mon shows up in. */
  seasonsUsedIn: number;
}

export interface CoachExtras {
  loading: boolean;
  /** Completed match results across all currently-managed leagues, oldest first. */
  results: CoachResult[];
  /** Top 3 most-rostered mons across the coach's current teams. */
  signatureMons: SignatureMon[];
}

/**
 * Aggregates the data needed by the win-rate sparkline + signature mons
 * panels on the coach-profile page. Uses only existing endpoints
 * (`getSchedule` + `getTeams` per current league); no new backend work.
 *
 * "Seasons" here is a proxy for distinct league tenures the user has held
 * a roster slot in — the public profile only surfaces their currently-held
 * teams, so historical roster mons aren't recoverable without new endpoints.
 */
export function useCoachExtras(profile: ApiPublicProfile | null): CoachExtras {
  const [results, setResults] = useState<CoachResult[]>([]);
  const [signatureMons, setSignatureMons] = useState<SignatureMon[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }

    const teams = profile.currentTeams;
    if (teams.length === 0) {
      setResults([]);
      setSignatureMons([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Fetch schedule + roster data for every league the coach is in,
    // in parallel. Failures per-league are swallowed so a single broken
    // league doesn't blank the whole profile.
    const work = teams.map(async t => {
      const [sched, leagueTeams] = await Promise.all([
        api.getSchedule(t.leagueId).catch(() => ({ matches: [], byes: [] })),
        api.getTeams(t.leagueId).catch(() => []),
      ]);
      return { tenure: t, schedule: sched, leagueTeams };
    });

    Promise.all(work).then(perLeague => {
      if (cancelled) return;

      // ─── Results timeline ─────────────────────────────────────────────
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

      // ─── Signature mons ───────────────────────────────────────────────
      // For each league, find the user's team and pull its roster. Each
      // (mon name) gets +1 per league it appears in. Ties broken by
      // alphabetical name for stable ordering.
      const counts = new Map<string, { count: number; isShiny: boolean }>();
      for (const { tenure, leagueTeams } of perLeague) {
        const myTeam = leagueTeams.find(lt => lt.id === tenure.teamId);
        if (!myTeam) continue;
        for (const mon of myTeam.roster) {
          const prev = counts.get(mon.name);
          if (prev) {
            prev.count += 1;
            // Shiny wins — even one shiny appearance flips the chip on.
            prev.isShiny = prev.isShiny || mon.isShiny;
          } else {
            counts.set(mon.name, { count: 1, isShiny: mon.isShiny });
          }
        }
      }
      const ranked: SignatureMon[] = Array.from(counts.entries())
        .map(([name, v]) => ({ name, isShiny: v.isShiny, seasonsUsedIn: v.count }))
        .sort((a, b) =>
          b.seasonsUsedIn - a.seasonsUsedIn ||
          a.name.localeCompare(b.name),
        )
        .slice(0, 3);
      setSignatureMons(ranked);

      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [profile]);

  return { loading, results, signatureMons };
}
