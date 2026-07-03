/**
 * Team personality strip — captain note + edit controls (owner only).
 * Renders inline on the team detail page right under HeaderStrip. Empty teams
 * (no captain_note, viewer is not the owner) collapse silently.
 */

import { useEffect, useRef, useState } from 'react';
import { Pencil, X, Camera } from 'lucide-react';
import type { Player } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { TeamLogo } from '@/components/team-logo';
import { useAuth } from '@/lib/auth-context';
import { canManageTeam } from '@/lib/permissions';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

interface PersonalityProps {
  player: Player;
  /** Re-fetch league data after a successful save so the UI reflects the new
   *  captain note without a full page reload. */
  onSaved?: () => void | Promise<void>;
}

const MAX_NOTE = 280;

export function Personality({ player, onSaved }: PersonalityProps) {
  const { user } = useAuth();
  const isOwner = canManageTeam(user, player);

  const [editing, setEditing] = useState(false);
  const [captainNote, setCaptainNote] = useState(player.captainNote ?? '');
  const [saving, setSaving] = useState(false);

  // Team logo upload (owner-facing — mirrors the admin panel's control).
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [localLogo, setLocalLogo] = useState<string | null>(player.logoPath ?? null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    setCaptainNote(player.captainNote ?? '');
    setLocalLogo(player.logoPath ?? null);
  }, [player.id, player.captainNote, player.logoPath]);

  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > MAX_LOGO_BYTES) { toast.error('Image must be under 2MB'); return; }
    setUploadingLogo(true);
    try {
      const result = await api.uploadTeamLogo(player.id, file);
      // Cache-bust: the filename is stable (teamId.ext) so the browser would
      // otherwise keep showing the previous logo.
      setLocalLogo(result.path.replace(/^\/uploads\//, '') + `?v=${Date.now()}`);
      await onSaved?.();
      toast.success('Team logo updated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleLogoRemove() {
    setUploadingLogo(true);
    try {
      await api.removeTeamLogo(player.id);
      setLocalLogo(null);
      await onSaved?.();
      toast.success('Team logo removed');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Remove failed'));
    } finally {
      setUploadingLogo(false);
    }
  }

  const hasContent = !!player.captainNote;

  if (!hasContent && !isOwner) return null;

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateTeam(player.id, {
        captainNote: captainNote.trim() === '' ? null : captainNote,
      });
      await onSaved?.();
      setEditing(false);
      toast.success('Team profile saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setCaptainNote(player.captainNote ?? '');
    setEditing(false);
  }

  if (editing) {
    return (
      <div
        className="rounded-lg border border-border-default bg-surface-raised p-4 space-y-4"
        style={{ ['--card-accent' as never]: player.teamColor }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Edit team identity
          </h3>
          <button
            type="button"
            onClick={handleCancel}
            className="text-text-muted hover:text-text-primary"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Team logo
          </label>
          <div className="flex items-center gap-3">
            <div className="group relative w-16 h-16 shrink-0">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                className="relative w-full h-full rounded-full overflow-hidden border-2 border-border-default hover:border-neon transition-colors"
                aria-label="Upload team logo"
              >
                <TeamLogo
                  abbrev={player.teamAbbrev}
                  color={player.teamColor}
                  size="xl"
                  logoPath={localLogo}
                  className="w-full h-full text-lg"
                />
                <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera size={18} className="text-white" />
                </span>
              </button>
              {uploadingLogo && (
                <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center text-[10px] text-white">
                  …
                </div>
              )}
            </div>
            <div className="flex flex-col items-start gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
              >
                {localLogo ? 'Replace image' : 'Upload image'}
              </Button>
              {localLogo && (
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  disabled={uploadingLogo}
                  className="px-3 text-[11px] text-loss/80 hover:text-loss disabled:opacity-50"
                >
                  Remove logo
                </button>
              )}
              <span className="px-3 text-[10px] text-text-muted">PNG/JPG/WebP, ≤2MB</span>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoFile}
              className="hidden"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Captain note
            </label>
            <span className="text-[10px] font-mono tabular-nums text-text-muted">
              {captainNote.length}/{MAX_NOTE}
            </span>
          </div>
          <textarea
            value={captainNote}
            maxLength={MAX_NOTE}
            onChange={(e) => setCaptainNote(e.target.value)}
            rows={3}
            placeholder="Why this roster, what's the plan, what to fear."
            className="w-full px-3 py-2 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neon/40 resize-y leading-snug"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group rounded-lg border border-border-default bg-surface-raised p-4 relative',
      )}
      style={{ ['--card-accent' as never]: player.teamColor }}
    >
      {isOwner && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-md border border-transparent hover:border-border-default hover:bg-surface-overlay/60 text-[10px] font-mono uppercase tracking-wider text-text-muted hover:text-neon transition-colors opacity-0 group-hover:opacity-100"
        >
          <Pencil size={10} />
          Edit
        </button>
      )}
      <div className="space-y-3 max-w-prose">
        {player.captainNote ? (
          <p className="text-sm text-text-secondary leading-snug whitespace-pre-line">
            {player.captainNote}
          </p>
        ) : isOwner ? (
          <p className="text-[12px] font-mono italic text-text-muted">
            Drop a captain note — flavor, trash talk, plans for the season.
          </p>
        ) : null}
      </div>
    </div>
  );
}
