/**
 * Simulator reset controls — per league + global.
 *
 * Reset Week (NumberInput picker) voids a week's matches; Full Reset is a
 * destructive global action behind a typed-confirm dialog (user must type
 * `reset`) with an optional masterSeed for deterministic re-seeding.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Undo2, AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { api, type ApiSimLeague } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';

interface Props {
  leagues: ApiSimLeague[];
  onChanged: () => void;
}

export function ResetControlsCard({ leagues, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  // Reset-week state
  const [resetLeagueId, setResetLeagueId] = useState<string>(leagues[0]?.id ?? '');
  const [resetWeek, setResetWeek] = useState(1);

  // Full-reset dialog state
  const [fullOpen, setFullOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [masterSeed, setMasterSeed] = useState('');

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      const msg = await fn();
      toast.success(msg);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Reset action failed');
    } finally {
      setBusy(null);
    }
  }

  const resetWeekAction = () => {
    if (!resetLeagueId) { toast.error('Pick a league first'); return; }
    return run('week', async () => {
      const r = await api.simResetWeek(resetLeagueId, resetWeek);
      const lg = leagues.find(l => l.id === resetLeagueId);
      return `${lg?.name ?? 'League'}: week ${r.week} reset (${r.matchesVoided} matches voided)`;
    });
  };

  async function executeFullReset() {
    setBusy('full');
    try {
      const r = await api.simReset(masterSeed.trim() ? { masterSeed: masterSeed.trim() } : undefined);
      toast.success(`Simulator reset — ${r.droppedTables} tables wiped, seed ${r.masterSeed}`);
      setFullOpen(false);
      setConfirmText('');
      setMasterSeed('');
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Full reset failed');
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy !== null;

  return (
    <div className="space-y-3">
      {/* Reset Week */}
      <div className="flex items-end gap-2 rounded-md border border-border-subtle bg-surface-overlay/40 p-2">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-mono uppercase tracking-wider text-text-muted mb-1">
            League
          </div>
          <Select value={resetLeagueId} onValueChange={(v) => v && setResetLeagueId(v)}>
            <SelectTrigger className="h-8 bg-surface-base text-[11px]">
              <SelectValue placeholder="Select league" />
            </SelectTrigger>
            <SelectContent>
              {leagues.map(l => (
                <SelectItem key={l.id} value={l.id} className="text-[11px]">
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-24">
          <div className="text-[9px] font-mono uppercase tracking-wider text-text-muted mb-1">
            Week
          </div>
          <NumberInput
            value={resetWeek}
            onChange={setResetWeek}
            min={1}
            max={99}
            className="h-8 bg-surface-base"
          />
        </div>
        <Button
          variant="outline" size="sm"
          className="h-8 text-[11px]"
          disabled={anyBusy}
          onClick={resetWeekAction}
        >
          <Undo2 size={13} className="text-draw" />
          {busy === 'week' ? 'Resetting…' : 'Reset Week'}
        </Button>
      </div>

      {/* Full reset — destructive */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-loss/30 bg-loss/[0.06] p-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-mono font-bold uppercase tracking-wide text-loss flex items-center gap-1.5">
            <AlertTriangle size={12} /> Full Reset
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            Drops every simulator table and re-seeds both fictional seasons.
          </div>
        </div>
        <Button
          variant="destructive" size="sm"
          className="h-8 text-[11px] shrink-0"
          disabled={anyBusy}
          onClick={() => setFullOpen(true)}
        >
          <RotateCcw size={13} />
          Full Reset
        </Button>
      </div>

      {/* Full-reset typed-confirm dialog */}
      <Dialog
        open={fullOpen}
        onOpenChange={(o) => { if (!o) { setFullOpen(false); setConfirmText(''); setMasterSeed(''); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-loss" />
              Full Simulator Reset
            </DialogTitle>
            <DialogDescription>
              This permanently drops every simulator table and re-seeds the two
              fictional seasons from scratch. All simulated drafts, matches,
              trades and standings will be wiped. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs text-text-secondary">
                Type <span className="font-mono text-loss">reset</span> to confirm.
              </div>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="reset"
                className="bg-surface-overlay"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-text-secondary">
                Master seed <span className="text-text-muted">(optional — deterministic re-seed)</span>
              </div>
              <Input
                value={masterSeed}
                onChange={(e) => setMasterSeed(e.target.value)}
                placeholder="leave blank for random"
                className="bg-surface-overlay font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFullOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy === 'full' || confirmText.trim() !== 'reset'}
              onClick={executeFullReset}
            >
              {busy === 'full' ? 'Resetting…' : 'Reset Simulator'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
