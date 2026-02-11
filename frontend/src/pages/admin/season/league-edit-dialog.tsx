import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { PRESET_COLORS, type EditableLeague } from './phase-config';

interface LeagueEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingLeague: EditableLeague | null;
  editName: string;
  setEditName: (name: string) => void;
  editColor: string;
  setEditColor: (color: string) => void;
  onSave: () => void;
}

export function LeagueEditDialog({
  open,
  onOpenChange,
  editingLeague,
  editName,
  setEditName,
  editColor,
  setEditColor,
  onSave,
}: LeagueEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingLeague ? 'Edit League' : 'New League'}</DialogTitle>
          <DialogDescription>
            {editingLeague ? 'Update the league name and color.' : 'Create a new league. You can add it to an active season later.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-text-muted">League Name</label>
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="e.g. Diamond League"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && onSave()}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-text-muted">Color</label>
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setEditColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      editColor === c ? 'border-white scale-110' : 'border-transparent hover:border-white/30'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1.5 ml-2">
                <Input
                  value={editColor}
                  onChange={e => setEditColor(e.target.value)}
                  className="w-24 text-xs font-mono h-7"
                  placeholder="#hex"
                />
                <div
                  className="w-7 h-7 rounded-full border border-border shrink-0"
                  style={{ backgroundColor: editColor }}
                />
              </div>
            </div>
          </div>
          {/* Preview */}
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Preview</label>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-overlay">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: editColor }} />
              <span className="text-sm font-medium text-text-primary">{editName || 'League Name'}</span>
              <Badge variant="outline" className="text-[10px] ml-auto" style={{
                borderColor: `${editColor}40`, color: editColor, backgroundColor: `${editColor}10`,
              }}>
                {(editName || 'League').replace(' League', '')}
              </Badge>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onSave}
            disabled={!editName.trim()}
            className="bg-neon text-surface-base hover:bg-neon/90"
          >
            {editingLeague ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
