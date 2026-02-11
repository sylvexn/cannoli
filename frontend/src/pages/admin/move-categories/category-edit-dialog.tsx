import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

interface CategoryEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editCatId: string | null;
  editCatName: string;
  onEditCatNameChange: (name: string) => void;
  onSave: () => void;
}

export function CategoryEditDialog({
  open,
  onOpenChange,
  editCatId,
  editCatName,
  onEditCatNameChange,
  onSave,
}: CategoryEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editCatId ? 'Rename Category' : 'New Category'}</DialogTitle>
          <DialogDescription>
            {editCatId ? 'Update the category name.' : 'Create a new move/ability category for matchup analysis.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label className="text-xs text-text-muted">Category Name</label>
          <Input
            value={editCatName}
            onChange={e => onEditCatNameChange(e.target.value)}
            placeholder="e.g. Hazards, Priority, Weather"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && onSave()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onSave}
            disabled={!editCatName.trim()}
            className="bg-neon text-surface-base hover:bg-neon/90"
          >
            {editCatId ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
