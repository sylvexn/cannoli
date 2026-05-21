/**
 * In-place profile settings panel surfaced ON the coach profile page itself
 * (not in /settings) so the owner can edit bio / status / banner without
 * leaving the surface where the changes are visible. The /settings page
 * still owns avatar + colors + display name; this panel deliberately scopes
 * down to the new "personality" fields the surface pass introduced.
 */

import { useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
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

const MAX_BIO = 280;
const MAX_STATUS = 80;

interface ProfileSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  profile: ApiPublicProfile;
  /** Called after a successful save so the parent can re-fetch fresh data. */
  onSaved: () => void | Promise<void>;
}

export function ProfileSettingsPanel({
  open, onClose, profile, onSaved,
}: ProfileSettingsPanelProps) {
  const [bio, setBio] = useState(profile.bio ?? '');
  const [statusMessage, setStatusMessage] = useState(profile.statusMessage ?? '');
  const [bannerPreview, setBannerPreview] = useState<string | null>(profile.bannerUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Reset local state when the dialog re-opens against a fresh profile.
  useEffect(() => {
    if (!open) return;
    setBio(profile.bio ?? '');
    setStatusMessage(profile.statusMessage ?? '');
    setBannerPreview(profile.bannerUrl ?? null);
  }, [open, profile.bio, profile.statusMessage, profile.bannerUrl]);

  const dirty =
    bio !== (profile.bio ?? '') ||
    statusMessage !== (profile.statusMessage ?? '');

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateMe({
        bio: bio.trim() === '' ? null : bio,
        statusMessage: statusMessage.trim() === '' ? null : statusMessage.trim(),
      });
      await onSaved();
      toast.success('Profile saved');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleBannerFile(file: File) {
    setUploading(true);
    try {
      const res = await api.uploadUserBanner(file);
      setBannerPreview(res.path);
      await onSaved();
      toast.success('Banner updated');
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleClearBanner() {
    setUploading(true);
    try {
      await api.updateMe({ bannerUrl: null });
      setBannerPreview(null);
      await onSaved();
      toast.success('Banner cleared');
    } catch (err: any) {
      toast.error(err?.message || 'Clear failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-wider text-sm">
            <span className="text-neon">Edit</span>{' '}
            <span className="text-text-primary">Profile</span>
          </DialogTitle>
          <DialogDescription>
            Banner, status, and bio. Avatar and colors live in{' '}
            <span className="font-mono text-text-secondary">/settings</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Banner preview + upload */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Banner
            </label>
            <div className="relative h-24 w-full rounded-lg overflow-hidden border border-border-default bg-surface-overlay/30">
              {bannerPreview ? (
                <img
                  src={bannerPreview}
                  alt="Banner preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] font-mono text-text-muted">
                  Gradient fallback
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleBannerFile(f);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={12} />
                {uploading ? 'Uploading…' : 'Upload image'}
              </Button>
              {bannerPreview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={handleClearBanner}
                >
                  <X size={12} />
                  Clear
                </Button>
              )}
              <span className="text-[10px] font-mono text-text-muted ml-auto">≤ 1 MB</span>
            </div>
          </div>

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
