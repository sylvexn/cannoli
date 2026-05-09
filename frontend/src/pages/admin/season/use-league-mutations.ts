import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { PRESET_COLORS, type EditableLeague, type Phase } from './phase-config';

interface UseLeagueMutationsArgs {
  leagueList: EditableLeague[];
  leagueStates: Record<string, { phase?: string; [k: string]: any }>;
  refreshLeagues?: () => void;
}

/**
 * Owns the league create/edit/delete + force-regen-schedule flows.
 * Each flow has its own dialog state plus an open* / execute* pair so
 * the parent only needs to mount the dialog component and pass props.
 */
export function useLeagueMutations({ leagueList, leagueStates, refreshLeagues }: UseLeagueMutationsArgs) {
  // League edit dialog
  const [leagueEditOpen, setLeagueEditOpen] = useState(false);
  const [editingLeague, setEditingLeague] = useState<EditableLeague | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // Delete league confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Regenerate schedule confirmation (in-season nuclear option)
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenTarget, setRegenTarget] = useState<{ id: string; name: string; phase: Phase } | null>(null);
  const [regenConfirmText, setRegenConfirmText] = useState('');
  const [regenSubmitting, setRegenSubmitting] = useState(false);

  const openNewLeague = useCallback(() => {
    setEditingLeague(null);
    setEditName('');
    setEditColor(PRESET_COLORS.find(c => !leagueList.some(l => l.color === c)) ?? PRESET_COLORS[0]);
    setLeagueEditOpen(true);
  }, [leagueList]);

  const openEditLeague = useCallback((league: EditableLeague) => {
    setEditingLeague(league);
    setEditName(league.name);
    setEditColor(league.color);
    setLeagueEditOpen(true);
  }, []);

  const saveLeague = useCallback(async () => {
    const name = editName.trim();
    if (!name) return;
    try {
      if (editingLeague) {
        await api.updateLeague(editingLeague.id, { name, color: editColor });
        toast.success(`Updated "${name}"`);
      } else {
        await api.createLeague(name, editColor);
        toast.success(`Created "${name}"`);
      }
      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
    setLeagueEditOpen(false);
  }, [editName, editColor, editingLeague, refreshLeagues]);

  const confirmDeleteLeague = useCallback((id: string) => {
    setDeleteTarget(id);
    setDeleteConfirmText('');
    setDeleteOpen(true);
  }, []);

  const executeDeleteLeague = useCallback(async () => {
    if (!deleteTarget) return;
    const target = leagueList.find(l => l.id === deleteTarget);
    if (!target) return;
    const phase = leagueStates[deleteTarget]?.phase as Phase | undefined;
    const isLive = phase === 'regular' || phase === 'playoffs';

    if (isLive && deleteConfirmText.trim() !== target.name) {
      toast.error(`Type the league name "${target.name}" to confirm deletion`);
      return;
    }

    setDeleteSubmitting(true);
    try {
      await api.deleteLeague(deleteTarget, isLive ? { force: true, confirmName: target.name } : undefined);
      toast.success(`Deleted "${target.name}"`);
      refreshLeagues?.();
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeleteConfirmText('');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleteSubmitting(false);
    }
  }, [deleteTarget, deleteConfirmText, leagueList, leagueStates, refreshLeagues]);

  /**
   * Generates a league's schedule. If the league is already in regular/playoffs,
   * routes to the destructive regen confirmation dialog instead of running
   * inline (frontend mirrors backend's force/confirmName guard).
   */
  const handleGenerateSchedule = useCallback(async (league: EditableLeague) => {
    const state = leagueStates[league.id];
    const ph = state?.phase as Phase | undefined;
    if (ph === 'regular' || ph === 'playoffs') {
      setRegenTarget({ id: league.id, name: league.name, phase: ph });
      setRegenConfirmText('');
      setRegenOpen(true);
      return;
    }
    try {
      const result = await api.generateSchedule(league.id);
      toast.success(`Generated ${result.matchCount} matches`);
      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [leagueStates, refreshLeagues]);

  const executeForcedRegen = useCallback(async () => {
    if (!regenTarget) return;
    if (regenConfirmText.trim() !== regenTarget.name) {
      toast.error(`Type the league name exactly to confirm: "${regenTarget.name}"`);
      return;
    }
    setRegenSubmitting(true);
    try {
      await api.generateSchedule(regenTarget.id, { force: true, confirmName: regenConfirmText.trim() });
      toast.success(`Schedule regenerated for ${regenTarget.name}`);
      refreshLeagues?.();
      setRegenOpen(false);
      setRegenTarget(null);
      setRegenConfirmText('');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRegenSubmitting(false);
    }
  }, [regenTarget, regenConfirmText, refreshLeagues]);

  return {
    // edit/create
    leagueEditOpen, setLeagueEditOpen,
    editingLeague, editName, setEditName, editColor, setEditColor,
    openNewLeague, openEditLeague, saveLeague,
    // delete
    deleteOpen, setDeleteOpen, deleteTarget,
    deleteConfirmText, setDeleteConfirmText, deleteSubmitting,
    confirmDeleteLeague, executeDeleteLeague,
    // regen
    regenOpen, setRegenOpen, regenTarget,
    regenConfirmText, setRegenConfirmText, regenSubmitting,
    handleGenerateSchedule, executeForcedRegen,
  };
}
