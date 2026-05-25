/**
 * Team personality strip — captain note + edit controls (owner only).
 * Renders inline on the team detail page right under HeaderStrip. Empty teams
 * (no captain_note, viewer is not the owner) collapse silently.
 */

import { useEffect, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { Player } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { canManageTeam } from '@/lib/permissions';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';

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

  useEffect(() => {
    setCaptainNote(player.captainNote ?? '');
  }, [player.id, player.captainNote]);

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
            className="w-full px-3 py-2 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40 resize-y leading-snug"
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
          <p className="text-[12px] font-mono italic text-text-muted/60">
            Drop a captain note — flavor, trash talk, plans for the season.
          </p>
        ) : null}
      </div>
    </div>
  );
}
