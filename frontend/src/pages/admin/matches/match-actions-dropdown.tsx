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
  Upload, FileText, RefreshCw, ArrowLeftRight,
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
  // A recorded result exists — re-uploading must void it first, then import.
  const hasResult =
    match.homeScore !== null || match.awayScore !== null ||
    match.status === 'completed' || match.status === 'disputed';
  const [voidOpen, setVoidOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveWeek, setMoveWeek] = useState(match.week);
  const [moveDeadline, setMoveDeadline] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importRoom, setImportRoom] = useState('');
  const [importReplay, setImportReplay] = useState('');
  const [importFileName, setImportFileName] = useState('');
  // Side-assignment override: null = auto, 'p1IsHome' / 'p2IsHome' = manual
  const [sideOverride, setSideOverride] = useState<'p1IsHome' | 'p2IsHome' | null>(null);
  // After import: if sidesUncertain, show a side-confirm dialog
  const [sideConfirmOpen, setSideConfirmOpen] = useState(false);
  const [detectedP1, setDetectedP1] = useState('');
  const [detectedP2, setDetectedP2] = useState('');
  // Saved payload for re-import after side confirmation
  const [pendingImportPayload, setPendingImportPayload] = useState<{ replay?: string; roomId?: string } | null>(null);
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
    setSideOverride(null);
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

  async function executeImport(forcedSideOverride?: 'p1IsHome' | 'p2IsHome') {
    const replay = importReplay.trim();
    const roomId = normalizeRoomId(importRoom);
    if (!replay && !roomId) {
      toast.error('Upload or paste a replay (or enter a room ID)');
      return;
    }
    setSubmitting(true);
    try {
      // Re-upload over an existing result: void first (backend rejects imports
      // onto finalized matches). If the void fails (e.g. a downstream playoff
      // match is already completed), surface it and STOP — don't import.
      if (hasResult) {
        try {
          await api.voidMatch(match.id);
        } catch (err: unknown) {
          toast.error(`Could not clear existing result — ${getErrorMessage(err)}`);
          setSubmitting(false);
          return;
        }
      }

      const effectiveSideOverride = forcedSideOverride ?? sideOverride ?? undefined;
      const payload = replay ? { replay } : { roomId };
      const res = await api.importMatchBattle(match.id, {
        ...payload,
        ...(effectiveSideOverride ? { sideOverride: effectiveSideOverride } : {}),
      });

      // When sides could not be auto-detected, surface a confirmation dialog
      // so the admin can verify or flip the assignment before moving on.
      if (res.sidesUncertain && !forcedSideOverride) {
        setDetectedP1(res.detectedP1 || 'p1');
        setDetectedP2(res.detectedP2 || 'p2');
        // Save payload so the re-import after confirmation uses the same source.
        setPendingImportPayload(payload);
        setSideConfirmOpen(true);
        // Don't close import dialog or call onChanged yet — wait for confirmation.
        // The match IS already recorded (p1=home as best-guess); confirmation
        // will re-import with the correct side if the admin flips it.
        toast.warning('Sides uncertain — please confirm team assignment below');
      } else {
        toast.success(`Recorded ${res.homeScore}–${res.awayScore}, ${res.pokemonCount} Pokemon`);
        setImportOpen(false);
        onChanged();
      }
    } catch (err: unknown) {
      // The void already cleared the result, so the match is back to scheduled —
      // make clear the admin can just retry the attach.
      if (hasResult) {
        toast.error(`Re-import failed — match result was cleared; retry the attach. (${getErrorMessage(err)})`);
        onChanged();
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  /** Called when admin confirms or flips side assignment after an uncertain import. */
  async function confirmSides(override: 'p1IsHome' | 'p2IsHome') {
    if (!pendingImportPayload) return;
    setSideConfirmOpen(false);
    // Restore the import payload into state so executeImport can read it.
    if (pendingImportPayload.replay) setImportReplay(pendingImportPayload.replay);
    if (pendingImportPayload.roomId) setImportRoom(pendingImportPayload.roomId);
    // Re-run with the chosen override. The match was already voided + imported
    // (with wrong sides) — void again + re-import with correct sides.
    await executeImport(override);
    setPendingImportPayload(null);
    setImportOpen(false);
    onChanged();
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
            {hasResult ? <RefreshCw size={12} /> : <Swords size={12} />}
            {hasResult ? 'Replace Result (re-upload)' : 'Attach Played Battle'}
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
              {hasResult ? (
                <>
                  <RefreshCw size={16} className="text-draw" />
                  Replace Result
                </>
              ) : (
                <>
                  <Swords size={16} className="text-neon" />
                  Attach Played Battle
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {hasResult
                ? `This VOIDS the existing result for ${homeName} vs ${awayName} (W${match.week}), then imports the new replay. Score and per-Pokemon stats are recomputed automatically.`
                : `Upload a coach's downloaded Showdown replay and record it as ${homeName} vs ${awayName} (W${match.week}). Score and per-Pokemon stats are filled in automatically.`}
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
                Advanced: room ID / side assignment
              </summary>
              <div className="mt-2 space-y-3">
                <div className="space-y-1">
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
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                    Side assignment (override if teams are reversed)
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setSideOverride(null)}
                      className={`flex-1 h-7 text-[10px] rounded border transition-colors ${
                        sideOverride === null
                          ? 'border-neon text-neon bg-neon/10'
                          : 'border-border text-text-muted hover:border-text-muted'
                      }`}
                    >
                      Auto-detect
                    </button>
                    <button
                      type="button"
                      onClick={() => setSideOverride('p1IsHome')}
                      className={`flex-1 h-7 text-[10px] rounded border transition-colors ${
                        sideOverride === 'p1IsHome'
                          ? 'border-neon text-neon bg-neon/10'
                          : 'border-border text-text-muted hover:border-text-muted'
                      }`}
                    >
                      p1 = {homeName}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSideOverride('p2IsHome')}
                      className={`flex-1 h-7 text-[10px] rounded border transition-colors ${
                        sideOverride === 'p2IsHome'
                          ? 'border-neon text-neon bg-neon/10'
                          : 'border-border text-text-muted hover:border-text-muted'
                      }`}
                    >
                      p2 = {homeName}
                    </button>
                  </div>
                  <p className="text-[10px] text-text-muted">
                    Use when all Pokemon flag "Not on roster" — the sides are probably reversed.
                  </p>
                </div>
              </div>
            </details>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button
              disabled={importDisabled}
              className={hasResult
                ? 'bg-draw text-surface-base hover:bg-draw/90'
                : 'bg-neon text-surface-base hover:bg-neon/90'}
              onClick={() => executeImport()}
            >
              {submitting
                ? (hasResult ? 'Replacing...' : 'Attaching...')
                : (hasResult ? 'Void & re-import' : 'Attach as this match')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Side-Assignment Confirmation — shown when auto-detection is uncertain */}
      <Dialog open={sideConfirmOpen} onOpenChange={setSideConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight size={16} className="text-draw" />
              Confirm Side Assignment
            </DialogTitle>
            <DialogDescription>
              Auto-detection could not determine which side is {homeName} (home). Verify or flip below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border p-2 bg-surface-overlay space-y-0.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">p1</div>
                <div className="font-medium text-text-primary truncate">{detectedP1 || '—'}</div>
              </div>
              <div className="rounded border border-border p-2 bg-surface-overlay space-y-0.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">p2</div>
                <div className="font-medium text-text-primary truncate">{detectedP2 || '—'}</div>
              </div>
            </div>
            <p className="text-[10px] text-text-muted">
              Choose which PS side maps to <strong>{homeName}</strong>. The match will be re-imported with that assignment.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="flex-1 text-xs"
              disabled={submitting}
              onClick={() => confirmSides('p1IsHome')}
            >
              p1 is {homeName}
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-xs"
              disabled={submitting}
              onClick={() => confirmSides('p2IsHome')}
            >
              p2 is {homeName}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
