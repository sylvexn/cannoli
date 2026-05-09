import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { phaseConfig, getNextPhase, type EditableLeague, type Phase } from './phase-config';

interface PhaseControlsArgs {
  leagueList: EditableLeague[];
  leagueStates: Record<string, { phase?: string; [k: string]: any }>;
  refreshLeagues?: () => void;
}

/**
 * Bundles the three phase-mutation flows for a league: forward (`advance`),
 * weekly tick (`week`), and backward override (`backward`). Each is gated by
 * a confirmation dialog whose state is owned here so the parent can mount the
 * shared dialog component once.
 */
export function usePhaseControls({ leagueList, leagueStates, refreshLeagues }: PhaseControlsArgs) {
  // Advance
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<{ leagueId: string; from: Phase; to: Phase } | null>(null);

  // Week tick
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekTarget, setWeekTarget] = useState<string | null>(null);

  // Backward override
  const [backwardOpen, setBackwardOpen] = useState(false);
  const [backwardTarget, setBackwardTarget] = useState<{ leagueId: string; from: Phase; to: Phase } | null>(null);
  const [backwardConfirmText, setBackwardConfirmText] = useState('');

  const confirmAdvance = useCallback((league: EditableLeague) => {
    const state = leagueStates[league.id];
    const next = getNextPhase(state.phase as Phase);
    if (!next) return;
    setAdvanceTarget({ leagueId: league.id, from: state.phase as Phase, to: next });
    setAdvanceOpen(true);
  }, [leagueStates]);

  const executeAdvance = useCallback(async () => {
    if (!advanceTarget) return;
    const { leagueId, from, to } = advanceTarget;
    try {
      await api.advancePhase(leagueId, to);
      const name = leagueList.find(l => l.id === leagueId)?.name;
      toast.success(`${name} advanced to ${phaseConfig[to].label}`);

      // Auto-generate schedule when transitioning from draft to regular
      if (from === 'draft' && to === 'regular') {
        try {
          const result = await api.generateSchedule(leagueId);
          toast.success(`Generated ${result.matchCount} matches for ${name}`);
        } catch (schedErr: any) {
          toast.error(`Phase advanced but schedule generation failed: ${schedErr.message}`);
        }
      }

      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
    setAdvanceOpen(false);
    setAdvanceTarget(null);
  }, [advanceTarget, leagueList, refreshLeagues]);

  const confirmWeekAdvance = useCallback((leagueId: string) => {
    setWeekTarget(leagueId);
    setWeekOpen(true);
  }, []);

  const executeWeekAdvance = useCallback(async () => {
    if (!weekTarget) return;
    try {
      const result = await api.advanceWeek(weekTarget);
      const name = leagueList.find(l => l.id === weekTarget)?.name;
      toast.success(`${name} advanced to Week ${result.week}`);
      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
    setWeekOpen(false);
    setWeekTarget(null);
  }, [weekTarget, leagueList, refreshLeagues]);

  // Backward (revert) phase. Used to undo an accidental advance — e.g.
  // playoffs → regular if the bracket was generated before someone realized
  // a forfeit needed re-entering. Backend rejects without { override, confirm }.
  const confirmBackward = useCallback((leagueId: string, _from: Phase, to: Phase) => {
    setBackwardTarget({ leagueId, from: _from, to });
    setBackwardConfirmText('');
    setBackwardOpen(true);
  }, []);

  const executeBackward = useCallback(async () => {
    if (!backwardTarget) return;
    if (backwardConfirmText.trim() !== 'I understand') {
      toast.error('Type "I understand" exactly to confirm');
      return;
    }
    try {
      await api.advancePhase(backwardTarget.leagueId, backwardTarget.to, {
        override: true,
        confirm: 'I understand',
      });
      toast.success(`Reverted to ${backwardTarget.to}`);
      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
    setBackwardOpen(false);
    setBackwardTarget(null);
    setBackwardConfirmText('');
  }, [backwardTarget, backwardConfirmText, refreshLeagues]);

  return {
    // advance
    advanceOpen, setAdvanceOpen, advanceTarget,
    confirmAdvance, executeAdvance,
    // week
    weekOpen, setWeekOpen, weekTarget,
    confirmWeekAdvance, executeWeekAdvance,
    // backward
    backwardOpen, setBackwardOpen, backwardTarget, setBackwardTarget,
    backwardConfirmText, setBackwardConfirmText,
    confirmBackward, executeBackward,
  };
}
