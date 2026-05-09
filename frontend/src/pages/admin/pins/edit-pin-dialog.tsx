/**
 * Override the recipient of an existing pin. Used for auto-awarded pins
 * (Garchomp, Cannoli, Cynthia) when the stat job picks the wrong winner —
 * the admin re-points the pin to the correct user without revoking and
 * re-awarding (which would mean re-keying the metadata too).
 *
 * Backed by `PATCH /api/admin/pins/:id`. The endpoint enforces the
 * (user_id, pin_def_id, season_id) unique index, so attempting to assign
 * the pin to a user who already holds it returns 409.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Pin } from '@/components/pin';
import { UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { api, type ApiPinRecent, type ApiAuthUser } from '@/lib/api';

interface EditPinDialogProps {
  pin: ApiPinRecent;
  users: ApiAuthUser[];
  onClose: () => void;
  onSaved: () => void;
}

export function EditPinDialog({ pin, users, onClose, onSaved }: EditPinDialogProps) {
  const [userId, setUserId] = useState<number | null>(pin.userId);
  const [userSearch, setUserSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredUsers = useMemo(() => {
    if (!userSearch) return users.slice(0, 25);
    const q = userSearch.toLowerCase();
    return users.filter(u => u.username.toLowerCase().includes(q)).slice(0, 25);
  }, [users, userSearch]);

  const selectedUser = useMemo(
    () => users.find(u => parseInt(u.id) === userId) ?? null,
    [users, userId],
  );

  const dirty = userId != null && userId !== pin.userId;

  async function handleSave() {
    if (!dirty || userId == null) return;
    setSubmitting(true);
    try {
      await api.updatePinRecipient(pin.id, { userId });
      toast.success(`Re-pointed '${pin.defName}' to ${selectedUser?.username}`);
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Pin
              def={{ id: pin.pinDefId, name: pin.defName, iconName: pin.defIconName, color: pin.defColor }}
              size="sm"
              noTooltip
            />
            <div>
              <DialogTitle className="leading-tight">Edit {pin.defName}</DialogTitle>
              <DialogDescription className="leading-snug">
                Re-point this pin to a different coach. Currently held by{' '}
                <span className="font-mono">{pin.username}</span>
                {pin.seasonId != null && ` for S${pin.seasonId}`}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-[11px] text-text-muted">New recipient</div>
            <Input
              value={userSearch}
              onChange={e => { setUserSearch(e.target.value); setUserId(null); }}
              placeholder="Search by username"
              className="h-8 text-xs"
            />
            {userSearch && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-border-default bg-surface-base">
                {filteredUsers.length === 0 ? (
                  <div className="text-[11px] text-text-muted px-2 py-1">No matches</div>
                ) : filteredUsers.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => { setUserId(parseInt(u.id)); setUserSearch(u.username); }}
                    className={cn(
                      'w-full text-left px-2 py-1 text-xs hover:bg-surface-overlay/40 transition-colors flex items-center justify-between',
                      userId === parseInt(u.id) && 'bg-surface-overlay/60',
                    )}
                  >
                    <span className="font-mono">{u.username}</span>
                    <span className="text-[10px] uppercase text-text-muted">{u.role}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedUser && (
              <div className={cn(
                'text-[11px]',
                dirty ? 'text-win' : 'text-text-muted',
              )}>
                {dirty ? 'New: ' : 'Currently: '}{selectedUser.username}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={handleSave} disabled={!dirty || submitting} size="sm">
            <UserCog size={12} />
            {submitting ? 'Saving...' : 'Re-point pin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
