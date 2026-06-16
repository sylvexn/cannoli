import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import type { ApiAdminMatch } from '@/lib/api';
import { toast } from 'sonner';
import { NumberInput } from '@/components/ui/number-input';
import {
  AlertTriangle, Trash2, MoreVertical,
  Eraser, ArrowRightLeft, Gavel, Swords,
  Upload, FileText,
} from 'lucide-react';
import type { TeamNameResolver } from '@/lib/use-team-names';
import { getErrorMessage } from '@/lib/errors';

/**
 * Best-effort client-side normalisation of a battle reference into a bare
 * `battle-...` room id. Accepts either a raw room id or a full replay/room URL
 * (e.g. `https://sim.cannoli.live/battle-gen9natdexdraft-12345?foo=1`). The
 * backend normalises too, so this only needs to be best-effort.
 */
function normalizeRoomId(raw: string): string {
  let v = raw.trim();
  // Strip query/hash first so a trailing `?turn=...` doesn't survive.
  v = v.split(/[?#]/)[0];
  // Drop scheme + host if a URL was pasted, keeping the final path segment.
  const slash = v.lastIndexOf('/');
  if (slash !== -1) v = v.slice(slash + 1);
  return v.trim();
}

export function MatchActionsDropdown({ match, teamNames, onChanged, onForceResult }: {
  match: ApiAdminMatch;
  teamNames: TeamNameResolver;
  onChanged: () => void;
  onForceResult: (match: ApiAdminMatch) => void;
}) {
  const homeName = teamNames.name(match.homeTeamId);
  const awayName = teamNames.name(match.awayTeamId);
  const [voidOpen, setVoidOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveWeek, setMoveWeek] = useState(match.week);
  const [moveDeadline, setMoveDeadline] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importRoom, setImportRoom] = useState('');
  const [importReplay, setImportReplay] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function openMove() {
    setMoveWeek(match.week);
    setMoveDeadline('');
    setMoveOpen(true);
  }

  function openImport() {
    setImportRoom('');
    setImportReplay('');
    setImportFileName('');
    setImportOpen(true);
  }

  async function handleReplayFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setImportReplay(text);
      setImportFileName(file.name);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  }

  async function executeVoid() {
    setSubmitting(true);
    try {
      await api.voidMatch(match.id);
      toast.success('Match result voided');
      setVoidOpen(false);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function executeDelete() {
    setSubmitting(true);
    try {
      await api.deleteMatch(match.id);
      toast.success('Match deleted');
      setDeleteOpen(false);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function executeMove() {
    if (!Number.isInteger(moveWeek) || moveWeek < 1) {
      toast.error('Week must be a positive integer');
      return;
    }
    setSubmitting(true);
    try {
      const payload: { week?: number; deadline?: string | null } = {};
      if (moveWeek !== match.week) payload.week = moveWeek;
      if (moveDeadline.trim()) {
        // Accept either ISO datetime or YYYY-MM-DD; normalise the date-only form to end-of-day UTC
        const d = moveDeadline.trim();
        payload.deadline = /^\d{4}-\d{2}-\d{2}$/.test(d)
          ? new Date(`${d}T23:59:59Z`).toISOString()
          : d;
      }
      if (Object.keys(payload).length === 0) {
        toast.error('No changes');
        setSubmitting(false);
        return;
      }
      await api.updateMatch(match.id, payload);
      toast.success('Match updated');
      setMoveOpen(false);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function executeImport() {
    const replay = importReplay.trim();
    const roomId = normalizeRoomId(importRoom);
    if (!replay && !roomId) {
      toast.error('Upload or paste a replay (or enter a room ID)');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.importMatchBattle(
        match.id,
        replay ? { replay } : { roomId },
      );
      toast.success(`Recorded ${res.homeScore}–${res.awayScore}, ${res.pokemonCount} Pokemon`);
      setImportOpen(false);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const importDisabled = submitting || (!importReplay.trim() && !importRoom.trim());

  const voidDisabled = match.homeScore === null && match.awayScore === null && match.status === 'scheduled';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Match actions"
          className="p-1 rounded hover:bg-surface-overlay/40 text-text-muted hover:text-text-primary transition-colors outline-none"
          onClick={e => e.stopPropagation()}
        >
          <MoreVertical size={12} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="text-xs min-w-[180px]">
          <DropdownMenuItem
            onClick={openMove}
            disabled={match.phase === 'playoffs'}
          >
            <ArrowRightLeft size={12} />
            Move Week / Deadline
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onForceResult(match)}
          >
            <Gavel size={12} />
            Force Result
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={openImport}
          >
            <Swords size={12} />
            Attach Played Battle
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setVoidOpen(true)}
            disabled={voidDisabled}
          >
            <Eraser size={12} />
            Void Result
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 size={12} />
            Delete Match
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Void Result Confirmation */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eraser size={16} className="text-draw" />
              Void Match Result
            </DialogTitle>
            <DialogDescription>
              {`Clear scores and per-Pokemon data for ${homeName} vs ${awayName} (W${match.week}). Status returns to scheduled. Activity log will record the change.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
            <Button
              disabled={submitting}
              className="bg-draw text-surface-base hover:bg-draw/90"
              onClick={executeVoid}
            >
              {submitting ? 'Voiding...' : 'Void Result'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Match Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-loss" />
              Delete Match
            </DialogTitle>
            <DialogDescription>
              <>
                Permanently delete <strong>{homeName} vs {awayName}</strong> (W{match.week})?
                Per-Pokemon data is removed. This cannot be undone.
              </>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={submitting}
              onClick={executeDelete}
            >
              {submitting ? 'Deleting...' : 'Delete Match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Week / Deadline */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft size={16} className="text-neon" />
              Move Match
            </DialogTitle>
            <DialogDescription>
              {`${homeName} vs ${awayName} — currently W${match.week}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Week</label>
              <NumberInput value={moveWeek} onChange={setMoveWeek} min={1} max={30} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Deadline (optional, YYYY-MM-DD or ISO)
              </label>
              <Input
                value={moveDeadline}
                onChange={e => setMoveDeadline(e.target.value)}
                placeholder="2026-05-14"
                className="h-8 text-xs bg-surface-overlay"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>Cancel</Button>
            <Button
              disabled={submitting}
              className="bg-neon text-surface-base hover:bg-neon/90"
              onClick={executeMove}
            >
              {submitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attach Played Battle */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords size={16} className="text-neon" />
              Attach Played Battle
            </DialogTitle>
            <DialogDescription>
              {`Upload a coach's downloaded Showdown replay and record it as ${homeName} vs ${awayName} (W${match.week}). Score and per-Pokemon stats are filled in automatically.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Replay file (.html download)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,.json,.txt,.log"
                className="hidden"
                onChange={handleReplayFile}
              />
              <Button
                variant="outline"
                className="w-full h-8 text-xs justify-start gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={12} />
                {importFileName || 'Choose replay file...'}
              </Button>
              {importFileName && (
                <p className="flex items-center gap-1 text-[10px] text-text-muted">
                  <FileText size={10} />
                  {`Loaded ${importFileName} (${importReplay.length.toLocaleString()} chars)`}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Or paste replay content
              </label>
              <Textarea
                value={importReplay}
                onChange={e => { setImportReplay(e.target.value); setImportFileName(''); }}
                placeholder={'<!DOCTYPE html>... or |player|p1|... protocol log'}
                className="min-h-[80px] max-h-[160px] text-xs bg-surface-overlay font-mono"
              />
            </div>
            <details className="group">
              <summary className="text-[10px] font-mono uppercase tracking-wider text-text-muted cursor-pointer select-none hover:text-text-primary">
                Advanced: room ID (legacy)
              </summary>
              <div className="mt-2 space-y-1">
                <Input
                  value={importRoom}
                  onChange={e => setImportRoom(e.target.value)}
                  placeholder="battle-gen9natdexdraft-12345"
                  className="h-8 text-xs bg-surface-overlay font-mono"
                />
                <p className="text-[10px] text-text-muted">
                  Reads a server-side saved replay by room ID. Only works for battles still on disk.
                </p>
              </div>
            </details>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button
              disabled={importDisabled}
              className="bg-neon text-surface-base hover:bg-neon/90"
              onClick={executeImport}
            >
              {submitting ? 'Attaching...' : 'Attach as this match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
