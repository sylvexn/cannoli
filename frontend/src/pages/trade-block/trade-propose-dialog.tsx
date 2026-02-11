import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface TradeProposeDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TradeProposeDialog({ open, onClose }: TradeProposeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propose Trade</DialogTitle>
          <DialogDescription>
            Send a trade proposal to this team's manager. It will need admin approval.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-center text-sm text-text-muted">
          Trade proposal form coming soon — backend required.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-neon text-surface-base hover:bg-neon/90"
            onClick={() => { onClose(); toast.success('Feature coming soon'); }}
          >
            Send Proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
