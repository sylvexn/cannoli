import { useState, useEffect, useCallback } from 'react';
import { api, type ApiLeague, type ApiMatch, type ApiTeam } from '@/lib/api';
import { toast } from 'sonner';
import type { EditableLeague } from './phase-config';
import { getErrorMessage } from '@/lib/errors';

export interface PlayoffInfo {
  hasBracket: boolean;
  matchCount: number;
  completedCount: number;
  /** Bracket matches being played on Showdown right now — rebuilding one
   *  orphans the live battle, so it gates the same way a result does. */
  liveCount: number;
  /** The seeding the bracket was actually built with, so re-opening the editor
   *  shows the admin's own last edit rather than snapping back to standings. */
  seeds: { seed: number; teamId: string }[];
}

/** Seed → team as the standing bracket has it. Later rounds repeat a seed
 *  (an SF slot filled by its QF winner), so first-wins keeps the round the
 *  seeding was authored in. */
function readBracketSeeding(matches: ApiMatch[]) {
  const bySeed = new Map<number, string>();
  for (const m of matches) {
    if (m.homeSeed && m.homePlayer && !bySeed.has(m.homeSeed)) bySeed.set(m.homeSeed, m.homePlayer);
    if (m.awaySeed && m.awayPlayer && !bySeed.has(m.awaySeed)) bySeed.set(m.awaySeed, m.awayPlayer);
  }
  return [...bySeed.entries()]
    .map(([seed, teamId]) => ({ seed, teamId }))
    .sort((a, b) => a.seed - b.seed);
}

/** Standings order fallback — /api/leagues/:id/teams already comes sorted by
 *  computeStandings, this just pins the ordering if that ever changes. */
function byStandings(teams: ApiTeam[]) {
  return [...teams].sort((a, b) =>
    b.record.wins - a.record.wins || (b.record.differential ?? 0) - (a.record.differential ?? 0));
}

/**
 * Owns playoff-bracket detection and the generate/edit-seeding dialog flow.
 * On mount (and whenever the league list changes) it scans every playoff-
 * phase league for an existing bracket so the cards can show "Edit Seeding"
 * vs "Generate", and how many of its matches already have results (which is
 * what makes a rebuild destructive).
 */
export function usePlayoffControls(defaultLeagues: ApiLeague[], refreshLeagues?: () => void) {
  const [playoffInfo, setPlayoffInfo] = useState<Record<string, PlayoffInfo>>({});
  const [playoffOpen, setPlayoffOpen] = useState(false);
  const [playoffTarget, setPlayoffTarget] = useState<
    { id: string; name: string; topN: number; isRegen: boolean; requiresConfirm: boolean } | null
  >(null);
  const [playoffTeams, setPlayoffTeams] = useState<ApiTeam[]>([]);
  const [seedOrder, setSeedOrder] = useState<string[]>([]);
  const [playoffConfirmText, setPlayoffConfirmText] = useState('');
  const [playoffSubmitting, setPlayoffSubmitting] = useState(false);

  // Detect existing bracket per league (look at schedule playoff matches).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info: Record<string, PlayoffInfo> = {};
      for (const l of defaultLeagues) {
        if (l.season?.phase !== 'playoffs') continue;
        try {
          const sched = await api.getSchedule(l.id);
          const playoffMatches = sched.matches.filter(m => m.phase === 'playoffs');
          info[l.id] = {
            hasBracket: playoffMatches.length > 0,
            matchCount: playoffMatches.length,
            completedCount: playoffMatches.filter(m => m.homeScore != null && m.awayScore != null).length,
            liveCount: playoffMatches.filter(m => m.status === 'in_progress').length,
            seeds: readBracketSeeding(playoffMatches),
          };
        } catch { /* ignore */ }
      }
      if (!cancelled) setPlayoffInfo(info);
    })();
    return () => { cancelled = true; };
  }, [defaultLeagues]);

  const openPlayoffsDialog = useCallback((league: EditableLeague, isRegen: boolean) => {
    const playoffN = (defaultLeagues.find(l => l.id === league.id) as any)?.playoffTeamCount ?? 6;
    setPlayoffTarget({
      id: league.id,
      name: league.name,
      topN: playoffN,
      isRegen,
      // Only a bracket with recorded results — or a battle in flight — is
      // destructive to rebuild.
      requiresConfirm: (playoffInfo[league.id]?.completedCount ?? 0) > 0
        || (playoffInfo[league.id]?.liveCount ?? 0) > 0,
    });
    setPlayoffTeams([]);
    setSeedOrder([]);
    setPlayoffConfirmText('');
    // Pre-fetch standings → seeding preview (editable from here)
    // Existing bracket → open on ITS seeding (teams it left out fall in behind,
    // in standings order). No bracket → plain standings.
    const existingSeeds = playoffInfo[league.id]?.seeds ?? [];
    api.getTeams(league.id)
      .then(teams => {
        const sorted = byStandings(teams);
        setPlayoffTeams(sorted);
        const seeded = existingSeeds.map(s => s.teamId).filter(id => sorted.some(t => t.id === id));
        setSeedOrder([...seeded, ...sorted.map(t => t.id).filter(id => !seeded.includes(id))]);
      })
      .catch(() => { setPlayoffTeams([]); setSeedOrder([]); });
    setPlayoffOpen(true);
  }, [defaultLeagues, playoffInfo]);

  const moveSeed = useCallback((idx: number, dir: -1 | 1) => {
    setSeedOrder(prev => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const resetSeeding = useCallback(() => {
    setSeedOrder(playoffTeams.map(t => t.id));
  }, [playoffTeams]);

  const executePlayoffs = useCallback(async () => {
    if (!playoffTarget) return;
    if (playoffTarget.requiresConfirm && playoffConfirmText.trim() !== playoffTarget.name) {
      toast.error(`Type the league name exactly to confirm: "${playoffTarget.name}"`);
      return;
    }
    setPlayoffSubmitting(true);
    try {
      // The typed league name was collected and then dropped on the floor —
      // the backend now refuses to wipe a bracket with results without it.
      const result = await api.generatePlayoffs(playoffTarget.id, {
        topN: playoffTarget.topN,
        seedOrder: seedOrder.slice(0, playoffTarget.topN),
        ...(playoffTarget.requiresConfirm
          ? { force: true, confirmName: playoffConfirmText.trim() }
          : {}),
      });
      toast.success(`Generated ${result.matchCount} bracket matches for ${playoffTarget.name}`);
      // Refresh local state so the button flips to "Edit Seeding"
      setPlayoffInfo(prev => ({
        ...prev,
        [playoffTarget.id]: {
          hasBracket: true,
          matchCount: result.matchCount,
          completedCount: 0,
          liveCount: 0,
          // Keep the just-saved seeding, so re-opening the editor shows it
          // without waiting for the league list to refetch.
          seeds: result.seedings,
        },
      }));
      refreshLeagues?.();
      setPlayoffOpen(false);
      setPlayoffTarget(null);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setPlayoffSubmitting(false);
    }
  }, [playoffTarget, playoffConfirmText, seedOrder, refreshLeagues]);

  return {
    playoffInfo,
    playoffOpen, setPlayoffOpen,
    playoffTarget, setPlayoffTarget,
    playoffTeams,
    seedOrder, setSeedOrder, moveSeed, resetSeeding,
    playoffConfirmText, setPlayoffConfirmText,
    playoffSubmitting,
    openPlayoffsDialog,
    executePlayoffs,
  };
}
