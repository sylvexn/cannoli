import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

export function OverlapConfirmDialog({
  open,
  onClose,
  priorSeasonNumber,
  priorPhase,
  newSeasonNumber,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  priorSeasonNumber: number;
  priorPhase: string;
  newSeasonNumber: number;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const expected = `S${priorSeasonNumber}`;
  const matches = typed.trim().toUpperCase() === expected;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setTyped(''); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-loss">
            <AlertTriangle size={16} />
            Overlap with active season
          </DialogTitle>
          <DialogDescription>
            Season {priorSeasonNumber} is currently in <span className="font-mono text-text-primary">{priorPhase}</span>.
            Creating Season {newSeasonNumber} now will leave both active simultaneously.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="rounded-lg border border-loss/30 bg-loss/5 p-3 text-xs text-text-secondary">
            Confirm by typing <span className="font-mono font-bold text-loss">{expected}</span> below.
          </div>
          <Input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={expected}
            autoFocus
            className="font-mono"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setTyped(''); onClose(); }}>Cancel</Button>
          <Button
            disabled={!matches}
            onClick={() => { setTyped(''); onConfirm(); }}
            className="bg-loss text-surface-base hover:bg-loss/90"
          >
            Create Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
