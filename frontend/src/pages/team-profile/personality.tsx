/**
 * Team personality strip — motto + captain note + edit controls (owner only).
 * Renders inline on the team detail page right under HeaderStrip. Empty teams
 * (no motto, no captain_note, viewer is not the owner) collapse silently.
 */

import { useEffect, useState } from 'react';
import { Pencil, X, Quote } from 'lucide-react';
import type { Player } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PersonalityProps {
  player: Player;
  /** Re-fetch league data after a successful save so the UI reflects the new
   *  motto / captain note without a full page reload. */
  onSaved?: () => void | Promise<void>;
}

const MAX_MOTTO = 80;
const MAX_NOTE = 280;

export function Personality({ player, onSaved }: PersonalityProps) {
  const { user, isAdmin } = useAuth();
  const isOwner = !!user && (
    isAdmin ||
    (player.userId != null && String(player.userId) === user.id)
  );

  const [editing, setEditing] = useState(false);
  const [motto, setMotto] = useState(player.motto ?? '');
  const [captainNote, setCaptainNote] = useState(player.captainNote ?? '');
  const [saving, setSaving] = useState(false);

  // Re-sync local form state when the underlying player updates (e.g. after
  // an external mutation refetches the league data).
  useEffect(() => {
    setMotto(player.motto ?? '');
    setCaptainNote(player.captainNote ?? '');
  }, [player.id, player.motto, player.captainNote]);

  const hasContent = !!player.motto || !!player.captainNote;

  // Hide the section entirely for non-owners on empty teams — no point
  // showing an empty card.
  if (!hasContent && !isOwner) return null;

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateTeam(player.id, {
        motto: motto.trim() === '' ? null : motto.trim(),
        captainNote: captainNote.trim() === '' ? null : captainNote,
      });
      await onSaved?.();
      setEditing(false);
      toast.success('Team profile saved');
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setMotto(player.motto ?? '');
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
              Motto
            </label>
            <span className="text-[10px] font-mono tabular-nums text-text-muted">
              {motto.length}/{MAX_MOTTO}
            </span>
          </div>
          <input
            type="text"
            value={motto}
            maxLength={MAX_MOTTO}
            onChange={(e) => setMotto(e.target.value)}
            placeholder="fortune favors the bold"
            className="w-full px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40"
          />
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
        {player.motto ? (
          <div className="flex items-start gap-2">
            <Quote size={14} className="shrink-0 mt-1 text-text-muted/60" />
            <p
              className="text-base font-heading italic leading-snug"
              style={{ color: player.teamColor }}
            >
              {player.motto}
            </p>
          </div>
        ) : isOwner ? (
          <p className="text-[12px] font-mono italic text-text-muted/60">
            Add a motto so the league knows what you stand for.
          </p>
        ) : null}
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
