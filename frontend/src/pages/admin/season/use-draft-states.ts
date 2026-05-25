import { useState, useEffect, useCallback } from 'react';
import { api, type ApiDraftState, type ApiLeague } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

/**
 * Fetches & caches draft state for any league currently in the `draft` phase.
 * Surfaces start/pause/resume actions that update local state optimistically.
 */
export function useDraftStates(defaultLeagues: ApiLeague[]) {
  const [draftStates, setDraftStates] = useState<Record<string, ApiDraftState | null>>({});

  const fetchDraftStates = useCallback(async () => {
    const states: Record<string, ApiDraftState | null> = {};
    for (const league of defaultLeagues) {
      if (league.season?.phase === 'draft') {
        try {
          const s = await api.getDraftState(league.id);
          states[league.id] = s;
        } catch { states[league.id] = null; }
      }
    }
    setDraftStates(states);
  }, [defaultLeagues]);

  useEffect(() => { fetchDraftStates(); }, [fetchDraftStates]);

  const handleStartDraft = useCallback(async (leagueId: string) => {
    try {
      const state = await api.startDraft(leagueId, 120);
      setDraftStates(prev => ({ ...prev, [leagueId]: state }));
      toast.success('Draft started!');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  }, []);

  const handlePauseDraft = useCallback(async (leagueId: string) => {
    try {
      await api.pauseDraft(leagueId);
      setDraftStates(prev => ({
        ...prev,
        [leagueId]: prev[leagueId] ? { ...prev[leagueId]!, status: 'paused' } : null,
      }));
      toast.success('Draft paused');
    } catch (err: unknown) { toast.error(getErrorMessage(err)); }
  }, []);

  const handleResumeDraft = useCallback(async (leagueId: string) => {
    try {
      const state = await api.resumeDraft(leagueId);
      setDraftStates(prev => ({ ...prev, [leagueId]: state }));
      toast.success('Draft resumed');
    } catch (err: unknown) { toast.error(getErrorMessage(err)); }
  }, []);

  return { draftStates, handleStartDraft, handlePauseDraft, handleResumeDraft };
}
