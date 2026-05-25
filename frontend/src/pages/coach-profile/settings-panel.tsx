/**
 * In-place profile settings panel surfaced ON the coach profile page itself
 * (not in /settings) so the owner can edit displayName / bio / status without
 * leaving the surface where the changes are visible. The /settings page
 * still owns avatar + colors; this panel scopes to identity + "personality"
 * fields surfaced on the profile.
 *
 * Banner uploads were removed — the field stays on the schema (admins set it
 * via direct DB / migration) but isn't user-facing.
 *
 * Two-sided gating: the same panel is reused when a dev/admin staffer is
 * viewing someone else's profile — they can edit bio / status on the
 * target's behalf. The save call routes through a different endpoint
 * (`updateUserAsStaff` vs `updateMe`) so the backend emits a distinct
 * `profile_edited_by_staff` audit event with the editor's user id in
 * metadata. Display name, avatar, and colors stay strictly self-service.
 */

import { useEffect, useState } from 'react';
import { api, type ApiPublicProfile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { MAX_DISPLAY_NAME } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errors';

const MAX_BIO = 280;
const MAX_STATUS = 80;

interface ProfileSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  profile: ApiPublicProfile;
  /** Called after a successful save so the parent can re-fetch fresh data. */
  onSaved: () => void | Promise<void>;
  /**
   * When true, the editor is staff editing someone else's profile (not the
   * owner). Affects:
   *   * which API endpoint the save hits (`updateUserAsStaff`)
   *   * the dialog title/header copy ("Editing as staff: {username}")
   *   * hides the display-name field — renaming other users belongs in the
   *     admin user editor, not in the in-place profile panel.
   */
  asStaff?: boolean;
}

export function ProfileSettingsPanel({
  open, onClose, profile, onSaved, asStaff = false,
}: ProfileSettingsPanelProps) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [statusMessage, setStatusMessage] = useState(profile.statusMessage ?? '');
  const [saving, setSaving] = useState(false);

  // Reset local state when the dialog re-opens against a fresh profile.
  useEffect(() => {
    if (!open) return;
    setDisplayName(profile.displayName ?? '');
    setBio(profile.bio ?? '');
    setStatusMessage(profile.statusMessage ?? '');
  }, [open, profile.displayName, profile.bio, profile.statusMessage]);

  const dirty =
    (!asStaff && displayName !== (profile.displayName ?? '')) ||
    bio !== (profile.bio ?? '') ||
    statusMessage !== (profile.statusMessage ?? '');

  async function handleSave() {
    setSaving(true);
    try {
      const sharedPayload = {
        bio: bio.trim() === '' ? null : bio,
        statusMessage: statusMessage.trim() === '' ? null : statusMessage.trim(),
      };
      if (asStaff) {
        await api.updateUserAsStaff(profile.username, sharedPayload);
      } else {
        await api.updateMe({
          ...sharedPayload,
          displayName: displayName.trim() === '' ? null : displayName.trim(),
        });
      }
      await onSaved();
      toast.success(asStaff ? `Updated ${profile.username}` : 'Profile saved');
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-wider text-sm">
            <span className="text-neon">Edit</span>{' '}
            <span className="text-text-primary">
              {asStaff ? `@${profile.username}` : 'Profile'}
            </span>
          </DialogTitle>
          <DialogDescription>
            {asStaff
              ? <>Editing as staff. This action is logged.</>
              : <>Display name, status, and bio. Avatar and colors live in{' '}
                  <span className="font-mono text-text-secondary">/settings</span>.</>
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Display name (owner only — staff cannot rename other users from
           *  this surface; that lives in the admin user editor). */}
          {!asStaff && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                  Display name
                </label>
                <span className="text-[10px] font-mono tabular-nums text-text-muted">
                  {displayName.length}/{MAX_DISPLAY_NAME}
                </span>
              </div>
              <input
                type="text"
                value={displayName}
                maxLength={MAX_DISPLAY_NAME}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={profile.username}
                className="w-full px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40"
              />
              <p className="text-[10px] text-text-muted">
                Shown instead of @{profile.username}. Leave blank to use your username.
              </p>
            </div>
          )}

          {/* Status one-liner */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Status
              </label>
              <span className="text-[10px] font-mono tabular-nums text-text-muted">
                {statusMessage.length}/{MAX_STATUS}
              </span>
            </div>
            <input
              type="text"
              value={statusMessage}
              maxLength={MAX_STATUS}
              onChange={(e) => setStatusMessage(e.target.value)}
              placeholder="looking for water-types"
              className="w-full px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40"
            />
          </div>

          {/* Bio */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Bio
              </label>
              <span className="text-[10px] font-mono tabular-nums text-text-muted">
                {bio.length}/{MAX_BIO}
              </span>
            </div>
            <textarea
              value={bio}
              maxLength={MAX_BIO}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Anything you want fellow coaches to know."
              className="w-full px-3 py-2 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40 resize-y leading-snug"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
