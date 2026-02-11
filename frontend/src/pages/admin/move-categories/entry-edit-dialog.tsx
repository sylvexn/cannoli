import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Zap, Dna } from 'lucide-react';

interface EntryEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editEntryIdx: number | null;
  entryName: string;
  onEntryNameChange: (name: string) => void;
  entryIsAbility: boolean;
  onEntryIsAbilityChange: (isAbility: boolean) => void;
  onSave: () => void;
}

export function EntryEditDialog({
  open,
  onOpenChange,
  editEntryIdx,
  entryName,
  onEntryNameChange,
  entryIsAbility,
  onEntryIsAbilityChange,
  onSave,
}: EntryEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editEntryIdx !== null ? 'Edit Entry' : 'Add Entry'}</DialogTitle>
          <DialogDescription>
            Add a move or ability to this category. Moves are checked against learnset data; abilities are checked against Pokemon abilities.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Name</label>
            <Input
              value={entryName}
              onChange={e => onEntryNameChange(e.target.value)}
              placeholder="e.g. Stealth Rock, Drought"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && onSave()}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Type</label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={!entryIsAbility ? 'default' : 'outline'}
                onClick={() => onEntryIsAbilityChange(false)}
                className={!entryIsAbility ? 'bg-neon text-surface-base' : undefined}
              >
                <Zap size={12} />
                Move
              </Button>
              <Button
                size="sm"
                variant={entryIsAbility ? 'default' : 'outline'}
                onClick={() => onEntryIsAbilityChange(true)}
                className={entryIsAbility ? 'bg-purple-500 text-white' : undefined}
              >
                <Dna size={12} />
                Ability
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onSave}
            disabled={!entryName.trim()}
            className="bg-neon text-surface-base hover:bg-neon/90"
          >
            {editEntryIdx !== null ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
