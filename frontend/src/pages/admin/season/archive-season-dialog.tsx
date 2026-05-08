import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Archive, Crown, Trophy, Flame, TrendingUp, Swords } from 'lucide-react';

/**
 * Confirms the "Archive Season" admin action — distinct from the simple
 * archived-flag toggle elsewhere in the section. The full ceremony also
 * forces phase=offseason on every league and mints all auto-pins (champion,
 * MVP, regular-season leader, win streak, sweeper, high score, steal of
 * the draft). Type-to-confirm because it's hard to undo.
 */

export function ArchiveSeasonDialog({
  open, onClose, seasonNumber, leagueCount, onConfirm, busy,
}: {
  open: boolean;
  onClose: () => void;
  seasonNumber: number;
  leagueCount: number;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [typed, setTyped] = useState('');
  const expected = `ARCHIVE S${seasonNumber}`;
  const matches = typed.trim().toUpperCase() === expected;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setTyped(''); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text-primary">
            <Archive size={16} className="text-purple-400" />
            Archive Season {seasonNumber}
          </DialogTitle>
          <DialogDescription>
            This locks the season as historical and writes auto-pins for every recipient.
            Future writes to its {leagueCount} league{leagueCount === 1 ? '' : 's'} will require <span className="font-mono">?force=1</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-border-default bg-surface-overlay/40 p-3 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              The action will:
            </div>
            <ul className="text-xs text-text-secondary space-y-1">
              <li className="flex items-center gap-1.5">
                <span className="font-mono text-text-muted">1.</span> Set archived flag on Season {seasonNumber}
              </li>
              <li className="flex items-center gap-1.5">
                <span className="font-mono text-text-muted">2.</span> Force every league to phase=offseason
              </li>
              <li className="flex items-center gap-1.5">
                <span className="font-mono text-text-muted">3.</span> Mint auto-pins:
              </li>
              <li className="grid grid-cols-2 gap-x-3 gap-y-1 ml-4 text-[11px]">
                <span className="flex items-center gap-1"><Crown size={10} className="text-draw" />Champion</span>
                <span className="flex items-center gap-1"><Trophy size={10} className="text-blue-400" />Reg-season #1</span>
                <span className="flex items-center gap-1"><Trophy size={10} className="text-orange-400" />Garchomp / Cynthia</span>
                <span className="flex items-center gap-1"><Flame size={10} className="text-red-400" />High Score</span>
                <span className="flex items-center gap-1"><TrendingUp size={10} className="text-emerald-400" />Steal of the Draft</span>
                <span className="flex items-center gap-1"><Swords size={10} className="text-purple-400" />Sweeper</span>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-purple-400/30 bg-purple-400/5 p-3 text-[11px] text-text-secondary space-y-1">
            <div>
              Re-running on an already-archived season is safe — pins re-mint based on current
              stats, useful after correcting match data.
            </div>
            <div>
              Confirm by typing <span className="font-mono font-bold text-purple-400">{expected}</span> below.
            </div>
          </div>
          <Input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={expected}
            autoFocus
            className="font-mono"
            disabled={busy}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { setTyped(''); onClose(); }}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            disabled={!matches || busy}
            onClick={() => { setTyped(''); onConfirm(); }}
            className="bg-purple-400 text-surface-base hover:bg-purple-400/90"
          >
            {busy ? 'Archiving…' : 'Archive Season'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
