import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { AlertTriangle } from 'lucide-react';
import { phaseConfig, type EditableLeague, type Phase } from './phase-config';

interface BackwardTarget {
  leagueId: string;
  from: Phase;
  to: Phase;
}

interface Props {
  leagueList: EditableLeague[];
  backwardOpen: boolean;
  setBackwardOpen: (v: boolean) => void;
  backwardTarget: BackwardTarget | null;
  setBackwardTarget: (v: BackwardTarget | null) => void;
  backwardConfirmText: string;
  setBackwardConfirmText: (v: string) => void;
  onExecuteBackward: () => void;
}

export function SeasonBackwardPhaseDialog({
  leagueList,
  backwardOpen, setBackwardOpen, backwardTarget, setBackwardTarget,
  backwardConfirmText, setBackwardConfirmText, onExecuteBackward,
}: Props) {
  return (
    <Dialog open={backwardOpen} onOpenChange={(o) => { if (!o) { setBackwardOpen(false); setBackwardTarget(null); setBackwardConfirmText(''); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-loss" />
            Revert Phase (Destructive)
          </DialogTitle>
          <DialogDescription>
            {backwardTarget && (
              <>
                Move <strong>{leagueList.find(l => l.id === backwardTarget.leagueId)?.name}</strong> backward from{' '}
                <strong>{phaseConfig[backwardTarget.from].label}</strong> to{' '}
                <strong>{phaseConfig[backwardTarget.to].label}</strong>.
                <span className="block mt-2 text-loss text-[11px]">
                  Backward phase moves can re-open trade gates, demote brackets, and confuse downstream auto-jobs.
                  This is logged as <span className="font-mono">phase_reverted</span>.
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">
            Type <span className="font-mono text-text-primary">I understand</span> to confirm.
          </div>
          <Input
            value={backwardConfirmText}
            onChange={(e) => setBackwardConfirmText(e.target.value)}
            placeholder="I understand"
            className="bg-surface-overlay"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setBackwardOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={backwardConfirmText.trim() !== 'I understand'}
            onClick={onExecuteBackward}
          >
            Revert Phase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
