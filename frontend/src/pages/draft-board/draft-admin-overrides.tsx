/**
 * Staff-only override controls for an active draft.
 *
 * Three actions, all admin-gated on both ends and activity-logged on the backend:
 *   - Force Pick: open a dialog to pick a team + Pokemon and submit on their behalf.
 *   - Skip Current: advance the snake order without recording a pick.
 *   - Undo Last: roll back the most recent pick (also rolls back season phase
 *     transition if the draft had completed).
 *
 * Lives in its own file to keep draft-control-bar.tsx under the 600-LOC limit.
 */

import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { TeamLogo } from '@/components/team-logo';
import { Crosshair, SkipForward, Undo2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLeague } from '@/lib/league-context';
import { api } from '@/lib/api';
import { getTierList, DEFAULT_FORMAT } from '@/data/tier-list';

interface DraftAdminOverridesProps {
  draftOrder: { id: string; teamAbbrev: string; teamColor: string; name: string; logoPath?: string | null }[];
  /** Names of Pokemon already drafted in this league (to filter the picker). */
  draftedNames: Set<string>;
  /** Whether there's at least one pick to undo. */
  canUndo: boolean;
}

export function DraftAdminOverrides({
  draftOrder, draftedNames, canUndo,
}: DraftAdminOverridesProps) {
  const league = useLeague();
  const [forcePickOpen, setForcePickOpen] = useState(false);
  const [forceTeamId, setForceTeamId] = useState<string>('');
  const [forcePokemon, setForcePokemon] = useState<string>('');
  const [forceSearch, setForceSearch] = useState('');
  const [busy, setBusy] = useState<'force' | 'skip' | 'undo' | null>(null);

  const format = league.costFormat ?? DEFAULT_FORMAT;
  const availablePokemon = useMemo(() => {
    const q = forceSearch.toLowerCase();
    return getTierList(format)
      .filter(e => !draftedNames.has(e.name))
      .filter(e => !q || e.name.toLowerCase().includes(q))
      .slice(0, 80); // cap so the dropdown doesn't render the entire dex
  }, [draftedNames, forceSearch, format]);

  const handleForcePick = useCallback(async () => {
    if (!forceTeamId || !forcePokemon) return;
    setBusy('force');
    try {
      await api.forceDraftPick(league.id, forceTeamId, forcePokemon);
      toast.success(`Force-picked ${forcePokemon} for ${forceTeamId}`);
      setForcePickOpen(false);
      setForceTeamId('');
      setForcePokemon('');
      setForceSearch('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Force pick failed');
    } finally {
      setBusy(null);
    }
  }, [forceTeamId, forcePokemon, league.id]);

  const handleSkip = useCallback(async () => {
    if (!confirm('Skip the current pick? The team on the clock will lose this slot.')) return;
    setBusy('skip');
    try {
      await api.skipDraftPick(league.id);
      toast.success('Pick skipped');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Skip failed');
    } finally {
      setBusy(null);
    }
  }, [league.id]);

  const handleUndo = useCallback(async () => {
    if (!confirm('Undo the most recent draft pick?')) return;
    setBusy('undo');
    try {
      const r = await api.undoDraftPick(league.id);
      toast.success(`Undid ${r.undonePick.teamId} → ${r.undonePick.pokemonName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Undo failed');
    } finally {
      setBusy(null);
    }
  }, [league.id]);

  return (
    <>
      <div className="flex items-center rounded border border-loss/30 overflow-hidden">
        <button
          onClick={() => setForcePickOpen(true)}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-loss hover:bg-loss/10 transition-colors border-r border-loss/30"
          title="Force pick on behalf of any team"
        >
          <Crosshair size={10} />
          force pick
        </button>
        <button
          onClick={handleSkip}
          disabled={busy === 'skip'}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-loss hover:bg-loss/10 transition-colors border-r border-loss/30 disabled:opacity-40"
          title="Skip the current pick"
        >
          {busy === 'skip' ? <Loader2 size={10} className="animate-spin" /> : <SkipForward size={10} />}
          skip
        </button>
        <button
          onClick={handleUndo}
          disabled={busy === 'undo' || !canUndo}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-loss hover:bg-loss/10 transition-colors disabled:opacity-40"
          title={canUndo ? 'Undo the most recent pick' : 'No picks to undo'}
        >
          {busy === 'undo' ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />}
          undo
        </button>
      </div>

      <Dialog open={forcePickOpen} onOpenChange={setForcePickOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crosshair size={16} className="text-loss" />
              Force Pick
            </DialogTitle>
            <DialogDescription>
              Submit a pick on behalf of any team. This will be activity-logged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-text-muted block mb-1">
                Team
              </label>
              <Select value={forceTeamId} onValueChange={v => setForceTeamId(v ?? '')}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Choose team..." />
                </SelectTrigger>
                <SelectContent>
                  {draftOrder.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" logoPath={p.logoPath} />
                        {p.teamAbbrev} — {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-text-muted block mb-1">
                Pokemon
              </label>
              <Input
                placeholder="Search Pokemon..."
                value={forceSearch}
                onChange={e => setForceSearch(e.target.value)}
                className="h-8 text-xs mb-1.5"
              />
              <Select value={forcePokemon} onValueChange={v => setForcePokemon(v ?? '')}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Choose Pokemon..." />
                </SelectTrigger>
                <SelectContent>
                  {availablePokemon.map(p => (
                    <SelectItem key={p.name} value={p.name} className="text-xs">
                      <span className="flex items-center justify-between gap-3 w-full">
                        <span>{p.name}</span>
                        <span className="text-[10px] font-mono text-text-muted">t{p.tier}</span>
                      </span>
                    </SelectItem>
                  ))}
                  {availablePokemon.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-text-muted">No matches</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setForcePickOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleForcePick}
              disabled={!forceTeamId || !forcePokemon || busy === 'force'}
              className="gap-1.5"
            >
              {busy === 'force' ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
              Force Pick
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
