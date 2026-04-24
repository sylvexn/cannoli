import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Eraser, ArrowRightLeft, Gavel,
} from 'lucide-react';

export function MatchActionsDropdown({ match, onChanged, onForceResult }: {
  match: ApiAdminMatch;
  onChanged: () => void;
  onForceResult: (match: ApiAdminMatch) => void;
}) {
  const [voidOpen, setVoidOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveWeek, setMoveWeek] = useState(match.week);
  const [moveDeadline, setMoveDeadline] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function openMove() {
    setMoveWeek(match.week);
    setMoveDeadline('');
    setMoveOpen(true);
  }

  async function executeVoid() {
    setSubmitting(true);
    try {
      await api.voidMatch(match.id);
      toast.success('Match result voided');
      setVoidOpen(false);
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
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
    } catch (err: any) {
      toast.error(err.message);
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
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

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
              {`Clear scores and per-Pokemon data for ${match.homeTeamId} vs ${match.awayTeamId} (W${match.week}). Status returns to scheduled. Activity log will record the change.`}
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
                Permanently delete <strong>{match.homeTeamId} vs {match.awayTeamId}</strong> (W{match.week})?
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
              {`${match.homeTeamId} vs ${match.awayTeamId} — currently W${match.week}`}
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
    </>
  );
}
