/**
 * Draft Center team store. One interface over two backends:
 *   - logged in  → server (owner-scoped CRUD, debounced autosave)
 *   - guest      → localStorage
 * Edits apply to local state immediately; persistence trails behind.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { DcTeam, DcTeamInput } from './types';
import { isLocalId, newLocalTeam, readLocalTeams, writeLocalTeams } from './local-store';

const SAVE_DEBOUNCE_MS = 700;

interface DcStore {
  teams: DcTeam[];
  loading: boolean;
  isServer: boolean;
  /** A server save is pending or in flight. */
  saving: boolean;
  /** Last persistence error (server failure / blocked localStorage), or null. */
  saveError: string | null;
  /** Guest teams still in localStorage (offered for import after login). */
  localCount: number;
  getTeam: (id: string) => DcTeam | undefined;
  createTeam: (input: DcTeamInput) => Promise<DcTeam>;
  updateTeam: (id: string, patch: Partial<DcTeamInput>) => void;
  deleteTeam: (id: string) => Promise<void>;
  duplicateTeam: (id: string) => Promise<DcTeam | null>;
  setShared: (id: string, enabled: boolean) => Promise<void>;
  /** Push every guest team to the account; clears them locally on success. */
  importLocal: () => Promise<number>;
}

const Ctx = createContext<DcStore | null>(null);

export function useDraftCenter(): DcStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDraftCenter must be used inside <DraftCenterProvider>');
  return v;
}

export function DraftCenterProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const isServer = !!user;
  const [teams, setTeams] = useState<DcTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localCount, setLocalCount] = useState(() => readLocalTeams().length);

  const patches = useRef(new Map<string, Partial<DcTeamInput>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const teamsRef = useRef<DcTeam[]>([]);
  teamsRef.current = teams;

  // Load whichever backend applies once auth has settled (and on login/logout).
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    if (!user) {
      setTeams(readLocalTeams());
      setLoading(false);
      return;
    }
    api.dcListTeams()
      .then(list => { if (!cancelled) setTeams(list); })
      .catch(err => { if (!cancelled) setSaveError(getErrorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    setLocalCount(readLocalTeams().length);
    return () => { cancelled = true; };
  }, [authLoading, user]);

  const flush = useCallback(async (id: string) => {
    const patch = patches.current.get(id);
    patches.current.delete(id);
    timers.current.delete(id);
    if (!patch) return;
    try {
      const saved = await api.dcUpdateTeam(id, patch);
      setSaveError(null);
      setTeams(prev => prev.map(t => (t.id === id ? { ...t, updatedAt: saved.updatedAt } : t)));
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setPending(n => Math.max(0, n - 1));
    }
  }, []);

  // Don't lose an edit made in the last debounce window when leaving the page.
  useEffect(() => {
    const t = timers.current;
    return () => { for (const id of [...t.keys()]) { clearTimeout(t.get(id)); void flush(id); } };
  }, [flush]);

  const getTeam = useCallback((id: string) => teams.find(t => t.id === id), [teams]);

  const createTeam = useCallback(async (input: DcTeamInput): Promise<DcTeam> => {
    if (user) {
      const created = await api.dcCreateTeam(input);
      setTeams(prev => [created, ...prev]);
      return created;
    }
    const t = newLocalTeam(input);
    const next = [t, ...teamsRef.current];
    if (!writeLocalTeams(next)) setSaveError('Could not save to this browser (storage blocked or full)');
    setTeams(next);
    return t;
  }, [user]);

  const updateTeam = useCallback((id: string, patch: Partial<DcTeamInput>) => {
    const now = new Date().toISOString();
    if (!user || isLocalId(id)) {
      const next = teamsRef.current.map(t => (t.id === id ? { ...t, ...patch, updatedAt: now } : t));
      setTeams(next);
      setSaveError(writeLocalTeams(next) ? null : 'Could not save to this browser (storage blocked or full)');
      return;
    }
    setTeams(prev => prev.map(t => (t.id === id ? { ...t, ...patch, updatedAt: now } : t)));
    const had = patches.current.has(id);
    patches.current.set(id, { ...patches.current.get(id), ...patch });
    if (!had) setPending(n => n + 1);
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => { void flush(id); }, SAVE_DEBOUNCE_MS));
  }, [user, flush]);

  const deleteTeam = useCallback(async (id: string) => {
    clearTimeout(timers.current.get(id));
    if (patches.current.delete(id)) setPending(n => Math.max(0, n - 1));
    timers.current.delete(id);
    if (user && !isLocalId(id)) await api.dcDeleteTeam(id);
    const next = teamsRef.current.filter(t => t.id !== id);
    setTeams(next);
    if (!user) writeLocalTeams(next);
  }, [user]);

  const duplicateTeam = useCallback(async (id: string): Promise<DcTeam | null> => {
    const src = teamsRef.current.find(t => t.id === id);
    if (!src) return null;
    if (user && !isLocalId(id)) {
      await flush(id); // make sure the copy sees the latest edits
      const copy = await api.dcDuplicateTeam(id);
      setTeams(prev => [copy, ...prev]);
      return copy;
    }
    return createTeam({ name: `${src.name} (copy)`, leagueId: src.leagueId, roster: structuredClone(src.roster) });
  }, [user, flush, createTeam]);

  const setShared = useCallback(async (id: string, enabled: boolean) => {
    await flush(id);
    const saved = await api.dcShareTeam(id, enabled);
    setTeams(prev => prev.map(t => (t.id === id ? { ...t, shareToken: saved.shareToken } : t)));
  }, [flush]);

  const importLocal = useCallback(async (): Promise<number> => {
    const local = readLocalTeams();
    if (local.length === 0 || !user) return 0;
    const res = await api.dcImportTeams(local.map(({ name, leagueId, roster }) => ({ name, leagueId, roster })));
    // Only drop the guest copies once the server has them.
    writeLocalTeams([]);
    setLocalCount(0);
    setTeams(prev => [...res.teams, ...prev]);
    return res.imported;
  }, [user]);

  const value = useMemo<DcStore>(() => ({
    teams, loading, isServer, saving: pending > 0, saveError, localCount,
    getTeam, createTeam, updateTeam, deleteTeam, duplicateTeam, setShared, importLocal,
  }), [teams, loading, isServer, pending, saveError, localCount, getTeam, createTeam, updateTeam, deleteTeam, duplicateTeam, setShared, importLocal]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read-only team list for other surfaces (e.g. the Matchup Center picker). */
export function useDraftCenterTeams(): { teams: DcTeam[]; loading: boolean } {
  const { user, isLoading } = useAuth();
  const [teams, setTeams] = useState<DcTeam[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    if (!user) {
      setTeams(readLocalTeams());
      setLoading(false);
      return;
    }
    api.dcListTeams()
      .then(l => { if (!cancelled) setTeams(l); })
      .catch(() => { if (!cancelled) setTeams([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isLoading, user]);
  return { teams, loading };
}
