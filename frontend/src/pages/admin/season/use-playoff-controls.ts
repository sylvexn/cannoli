import { useState, useEffect, useCallback } from 'react';
import { api, type ApiLeague } from '@/lib/api';
import { toast } from 'sonner';
import type { EditableLeague } from './phase-config';

export interface PlayoffInfo { hasBracket: boolean; matchCount: number }

/**
 * Owns playoff-bracket detection and the generate/regenerate dialog flow.
 * On mount (and whenever the league list changes) it scans every playoff-
 * phase league for an existing bracket so the cards can show "Regenerate"
 * vs "Generate".
 */
export function usePlayoffControls(defaultLeagues: ApiLeague[], refreshLeagues?: () => void) {
  const [playoffInfo, setPlayoffInfo] = useState<Record<string, PlayoffInfo>>({});
  const [playoffOpen, setPlayoffOpen] = useState(false);
  const [playoffTarget, setPlayoffTarget] = useState<{ id: string; name: string; topN: number; isRegen: boolean } | null>(null);
  const [playoffPreview, setPlayoffPreview] = useState<{ teamId: string; rank: number }[]>([]);
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
          info[l.id] = { hasBracket: playoffMatches.length > 0, matchCount: playoffMatches.length };
        } catch { /* ignore */ }
      }
      if (!cancelled) setPlayoffInfo(info);
    })();
    return () => { cancelled = true; };
  }, [defaultLeagues]);

  const openPlayoffsDialog = useCallback((league: EditableLeague, isRegen: boolean) => {
    const playoffN = (defaultLeagues.find(l => l.id === league.id) as any)?.playoffTeamCount ?? 6;
    setPlayoffTarget({ id: league.id, name: league.name, topN: playoffN, isRegen });
    setPlayoffPreview([]);
    setPlayoffConfirmText('');
    // Pre-fetch standings → seeding preview
    api.getTeams(league.id)
      .then(teams => {
        const seeded = [...teams]
          .sort((a, b) => {
            // teams from /api/leagues/:id/teams come pre-sorted by computeStandings,
            // but enforce by record + differential as fallback
            if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
            return (b.record.differential ?? 0) - (a.record.differential ?? 0);
          })
          .slice(0, playoffN);
        setPlayoffPreview(seeded.map((t, i) => ({ teamId: t.id, rank: i + 1 })));
      })
      .catch(() => setPlayoffPreview([]));
    setPlayoffOpen(true);
  }, [defaultLeagues]);

  const executePlayoffs = useCallback(async () => {
    if (!playoffTarget) return;
    if (playoffTarget.isRegen && playoffConfirmText.trim() !== playoffTarget.name) {
      toast.error(`Type the league name exactly to confirm: "${playoffTarget.name}"`);
      return;
    }
    setPlayoffSubmitting(true);
    try {
      const result = await api.generatePlayoffs(playoffTarget.id, { topN: playoffTarget.topN });
      toast.success(`Generated ${result.matchCount} bracket matches for ${playoffTarget.name}`);
      // Refresh local state so the button flips to "Regenerate"
      setPlayoffInfo(prev => ({
        ...prev,
        [playoffTarget.id]: { hasBracket: true, matchCount: result.matchCount },
      }));
      refreshLeagues?.();
      setPlayoffOpen(false);
      setPlayoffTarget(null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPlayoffSubmitting(false);
    }
  }, [playoffTarget, playoffConfirmText, refreshLeagues]);

  return {
    playoffInfo,
    playoffOpen, setPlayoffOpen,
    playoffTarget, setPlayoffTarget,
    playoffPreview,
    playoffConfirmText, setPlayoffConfirmText,
    playoffSubmitting,
    openPlayoffsDialog,
    executePlayoffs,
  };
}
