/**
 * State for the Awards Sheet: loads a season's leagues/teams/rosters, its
 * saved pins (drafts included) and the engine's suggestions, and tracks the
 * admin's pending edits per pin definition. Saving is a single bulk POST.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, type ApiBulkPinChange, type ApiPinSuggestion, type ApiPinUnresolved, type ApiSeasonPin,
} from '@/lib/api';
import { getErrorMessage, type ApiError } from '@/lib/errors';
import {
  rowFromPin, rowFromSuggestion, rowKey, sameRow,
  type SheetLeague, type SheetRow,
} from './types';

export interface SheetDiff {
  adds: SheetRow[];
  updates: SheetRow[];
  revokes: ApiSeasonPin[];
}

export function useAwardsSheet(seasonId: number, defId: string | null) {
  const [leagues, setLeagues] = useState<SheetLeague[]>([]);
  const [pins, setPins] = useState<ApiSeasonPin[]>([]);
  const [suggestions, setSuggestions] = useState<ApiPinSuggestion[]>([]);
  const [unresolved, setUnresolved] = useState<ApiPinUnresolved[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Pending edits per definition; absent = untouched (mirrors saved pins).
  const [edits, setEdits] = useState<Record<string, Map<string, SheetRow>>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lgs, pinRes, sugg] = await Promise.all([
        api.getSeasonLeagues(seasonId),
        api.getSeasonPins(seasonId),
        api.getPinSuggestions(seasonId),
      ]);
      const withTeams = await Promise.all(lgs.map(async l => {
        const teams = await api.getTeams(l.id);
        return {
          id: l.id, name: l.name, color: l.color,
          teams: teams.map(t => ({
            id: t.id, leagueId: l.id, teamName: t.teamName, teamAbbrev: t.teamAbbrev,
            teamColor: t.teamColor, owner: t.owner ?? null, roster: t.roster.map(r => r.name),
          })),
        } satisfies SheetLeague;
      }));
      setLeagues(withTeams);
      setPins(pinRes.pins);
      setSuggestions(sugg.suggestions);
      setUnresolved(sugg.unresolved);
      setEdits({});
      setRowErrors({});
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the awards sheet'));
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => { void load(); }, [load]);

  const defPins = useMemo(() => pins.filter(p => p.pinDefId === defId && p.teamId), [pins, defId]);
  const existing = useMemo(
    () => new Map(defPins.map(p => [rowKey(p.teamId!, p.matchId), p])),
    [defPins],
  );
  const defSuggestions = useMemo(
    () => suggestions.filter(s => s.pinDefId === defId),
    [suggestions, defId],
  );
  const defUnresolved = useMemo(
    () => unresolved.filter(u => u.pinDefId === defId),
    [unresolved, defId],
  );

  /** What should exist for this def: pending edits, else the saved pins. */
  const rows = useMemo(() => {
    if (!defId) return new Map<string, SheetRow>();
    return edits[defId] ?? new Map(defPins.map(p => [rowKey(p.teamId!, p.matchId), rowFromPin(p)]));
  }, [edits, defId, defPins]);

  const setRows = useCallback((fn: (m: Map<string, SheetRow>) => void) => {
    if (!defId) return;
    setEdits(prev => {
      const next = new Map(prev[defId] ?? defPins.map(p => [rowKey(p.teamId!, p.matchId), rowFromPin(p)] as const));
      fn(next);
      return { ...prev, [defId]: next };
    });
    setRowErrors({});
  }, [defId, defPins]);

  const diff: SheetDiff = useMemo(() => {
    const adds: SheetRow[] = [], updates: SheetRow[] = [];
    for (const [k, r] of rows) {
      const saved = existing.get(k);
      if (!saved) adds.push(r);
      else if (!sameRow(rowFromPin(saved), r)) updates.push(r);
    }
    const revokes = [...existing].filter(([k]) => !rows.has(k)).map(([, p]) => p);
    return { adds, updates, revokes };
  }, [rows, existing]);
  const changeCount = diff.adds.length + diff.updates.length + diff.revokes.length;

  const acceptAll = useCallback(() => {
    setRows(m => {
      for (const s of defSuggestions) {
        const k = rowKey(s.teamId, s.matchId);
        // Ties are a human call: never auto-accepted in bulk.
        if (!s.tie && !m.has(k)) m.set(k, rowFromSuggestion(s));
      }
    });
  }, [defSuggestions, setRows]);

  const revert = useCallback(() => {
    if (!defId) return;
    setEdits(prev => { const n = { ...prev }; delete n[defId]; return n; });
    setRowErrors({});
  }, [defId]);

  /** Returns true when the save went through. */
  const save = useCallback(async (seasonArchived: boolean): Promise<boolean> => {
    if (!defId) return false;
    const keys: string[] = [];
    const changes: ApiBulkPinChange[] = [];
    for (const p of diff.revokes) { keys.push(rowKey(p.teamId!, p.matchId)); changes.push({ op: 'revoke', pinId: p.id }); }
    for (const r of [...diff.adds, ...diff.updates]) {
      keys.push(rowKey(r.teamId, r.matchId));
      changes.push({
        op: 'award', teamId: r.teamId, pokemon: r.pokemon, nickname: r.nickname, note: r.note,
        matchId: r.matchId, stats: r.stats,
      });
    }
    setSaving(true);
    try {
      await api.bulkSavePins({ seasonId, pinDefId: defId, changes }, seasonArchived);
      await load();
      return true;
    } catch (e) {
      const body = (e as ApiError).body as { errors?: { index: number; error: string }[] } | undefined;
      if (body?.errors) {
        setRowErrors(Object.fromEntries(body.errors.map(x => [keys[x.index] ?? '', x.error])));
      }
      throw e;
    } finally {
      setSaving(false);
    }
  }, [defId, diff, seasonId, load]);

  const draftCount = pins.filter(p => !p.published).length;
  const publishedCount = pins.length - draftCount;

  return {
    leagues, pins, loading, error, load, existing, defSuggestions, defUnresolved, rows, setRows,
    diff, changeCount, acceptAll, revert, save, saving, rowErrors, draftCount, publishedCount,
  };
}
