/**
 * In-place profile settings panel surfaced ON the coach profile page itself
 * (not in /settings) so the owner can edit bio / status / banner without
 * leaving the surface where the changes are visible. The /settings page
 * still owns avatar + colors + display name; this panel deliberately scopes
 * down to the new "personality" fields the surface pass introduced.
 *
 * Two-sided gating: the same panel is reused when a dev/admin staffer is
 * viewing someone else's profile — they can edit bio / status / signature /
 * title / banner on the target's behalf. The save call routes through a
 * different endpoint (`updateUserAsStaff` vs `updateMe`) so the backend
 * emits a distinct `profile_edited_by_staff` audit event with the editor's
 * user id in metadata. Avatar + display-name + colors stay strictly self-
 * service (you can re-color yourself but not your friend).
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
import { POKEMON_TYPES, type PokemonType } from '@/lib/pokemon';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants';

const MAX_BIO = 280;
const MAX_STATUS = 80;
const MAX_TITLE = 40;

interface ProfileSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  profile: ApiPublicProfile;
  /** Called after a successful save so the parent can re-fetch fresh data. */
  onSaved: () => void | Promise<void>;
  /**
   * When true, the editor is staff editing someone else's profile (not the
   * owner). Affects:
   *   * which API endpoint the save / banner-clear hits
   *   * the dialog title/header copy ("Editing as staff: {username}")
   * Banner upload is intentionally not surfaced in staff mode — it routes
   * through the multipart `/api/users/me/banner` endpoint which always
   * targets the caller, so allowing it here would silently overwrite the
   * staffer's own banner. Use the `bannerUrl` text patch to clear.
   */
  asStaff?: boolean;
}

export function ProfileSettingsPanel({
  open, onClose, profile, onSaved, asStaff = false,
}: ProfileSettingsPanelProps) {
  const [bio, setBio] = useState(profile.bio ?? '');
  const [statusMessage, setStatusMessage] = useState(profile.statusMessage ?? '');
  const [bannerPreview, setBannerPreview] = useState<string | null>(profile.bannerUrl ?? null);
  // ─── Coach flair state ──────────────────────────────────────────────────
  const [title, setTitle] = useState(profile.title ?? '');
  const [signatureType, setSignatureType] = useState<string | null>(profile.signatureType ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Reset local state when the dialog re-opens against a fresh profile.
  useEffect(() => {
    if (!open) return;
    setBio(profile.bio ?? '');
    setStatusMessage(profile.statusMessage ?? '');
    setBannerPreview(profile.bannerUrl ?? null);
    setTitle(profile.title ?? '');
    setSignatureType(profile.signatureType ?? null);
  }, [
    open, profile.bio, profile.statusMessage, profile.bannerUrl,
    profile.title, profile.signatureType,
  ]);

  const dirty =
    bio !== (profile.bio ?? '') ||
    statusMessage !== (profile.statusMessage ?? '') ||
    title !== (profile.title ?? '') ||
    signatureType !== (profile.signatureType ?? null);

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        bio: bio.trim() === '' ? null : bio,
        statusMessage: statusMessage.trim() === '' ? null : statusMessage.trim(),
        title: title.trim() === '' ? null : title.trim(),
        signatureType: signatureType ?? null,
      };
      if (asStaff) {
        await api.updateUserAsStaff(profile.username, payload);
      } else {
        await api.updateMe(payload);
      }
      await onSaved();
      toast.success(asStaff ? `Updated ${profile.username}` : 'Profile saved');
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
      if (asStaff) {
        await api.updateUserAsStaff(profile.username, { bannerUrl: null });
      } else {
        await api.updateMe({ bannerUrl: null });
      }
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
            <span className="text-text-primary">
              {asStaff ? `@${profile.username}` : 'Profile'}
            </span>
          </DialogTitle>
          <DialogDescription>
            {asStaff
              ? <>Editing as staff. This action is logged.</>
              : <>Banner, status, and bio. Avatar and colors live in{' '}
                  <span className="font-mono text-text-secondary">/settings</span>.</>
            }
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
              {!asStaff && (
                <>
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
                </>
              )}
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
              <span className="text-[10px] font-mono text-text-muted ml-auto">
                {asStaff ? 'Owner-only upload' : '≤ 1 MB'}
              </span>
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

          {/* ─── Coach flair section ─────────────────────────────────────── */}
          <div className="space-y-3 pt-3 border-t border-border-subtle/50">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Flair
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                  Title
                </label>
                <span className="text-[10px] font-mono tabular-nums text-text-muted">
                  {title.length}/{MAX_TITLE}
                </span>
              </div>
              <input
                type="text"
                value={title}
                maxLength={MAX_TITLE}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="The Garchomp Curse"
                className="w-full px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40"
              />
            </div>

            {/* Signature type */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Signature type
              </label>
              <div className="flex flex-wrap gap-1">
                <TypeSwatch
                  type={null}
                  selected={signatureType === null}
                  onClick={() => setSignatureType(null)}
                />
                {POKEMON_TYPES.map((t) => (
                  <TypeSwatch
                    key={t}
                    type={t}
                    selected={signatureType === t}
                    onClick={() => setSignatureType(t)}
                  />
                ))}
              </div>
            </div>

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

// ─── Sub-components ────────────────────────────────────────────────────────

/** Single colored chip for the type selector. `type` of null renders the
 *  "no signature" choice as a quiet outlined dash. */
function TypeSwatch({
  type, selected, onClick,
}: { type: PokemonType | null; selected: boolean; onClick: () => void }) {
  if (type === null) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={
          'inline-flex items-center justify-center px-2 py-1 rounded text-[9px] font-mono font-bold uppercase tracking-wider transition-colors ' +
          (selected
            ? 'bg-neon/15 text-neon ring-1 ring-neon/40'
            : 'bg-surface-overlay/40 text-text-muted ring-1 ring-border-subtle hover:text-text-primary')
        }
        title="No signature type"
      >
        None
      </button>
    );
  }
  const color = TYPE_COLORS[type];
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center px-2 py-1 rounded text-[9px] font-mono font-bold uppercase tracking-wider transition-transform hover:scale-105"
      style={{
        backgroundColor: selected ? color : `${color}26`,
        color: selected ? '#0a0a14' : color,
        boxShadow: `inset 0 0 0 ${selected ? 1.5 : 1}px ${color}`,
      }}
      title={type}
    >
      {TYPE_LABELS[type]}
    </button>
  );
}

