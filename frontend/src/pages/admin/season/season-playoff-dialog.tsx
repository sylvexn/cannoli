import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { Trophy, GripVertical, ChevronUp, ChevronDown, ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApiTeam } from '@/lib/api';

interface PlayoffTarget {
  id: string;
  name: string;
  topN: number;
  isRegen: boolean;
  requiresConfirm: boolean;
}

interface Props {
  playoffOpen: boolean;
  setPlayoffOpen: (v: boolean) => void;
  playoffTarget: PlayoffTarget | null;
  setPlayoffTarget: (v: PlayoffTarget | null) => void;
  playoffTeams: ApiTeam[];
  seedOrder: string[];
  setSeedOrder: (v: string[]) => void;
  moveSeed: (idx: number, dir: -1 | 1) => void;
  resetSeeding: () => void;
  playoffConfirmText: string;
  setPlayoffConfirmText: (v: string) => void;
  playoffSubmitting: boolean;
  onExecutePlayoffs: () => void;
}

export function SeasonPlayoffDialog({
  playoffOpen, setPlayoffOpen, playoffTarget, setPlayoffTarget,
  playoffTeams, seedOrder, setSeedOrder, moveSeed, resetSeeding,
  playoffConfirmText, setPlayoffConfirmText,
  playoffSubmitting, onExecutePlayoffs,
}: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const teamMap = new Map(playoffTeams.map(t => [t.id, t]));
  const topN = playoffTarget?.topN ?? 0;
  const destructive = !!playoffTarget?.requiresConfirm;

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const next = [...seedOrder];
    const [removed] = next.splice(dragIdx, 1);
    next.splice(idx, 0, removed);
    setSeedOrder(next);
    setDragIdx(idx);
  }

  return (
    <Dialog open={playoffOpen} onOpenChange={(o) => { if (!o) { setPlayoffOpen(false); setPlayoffTarget(null); setPlayoffConfirmText(''); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={16} className="text-pink" />
            {playoffTarget?.isRegen ? 'Edit Playoff Seeding' : 'Generate Playoff Bracket'}
          </DialogTitle>
          <DialogDescription>
            {playoffTarget && (
              <>
                <strong>{playoffTarget.name}</strong> — top <strong>{playoffTarget.topN}</strong> teams.
                Drag or use the arrows to reorder; the bracket is rebuilt from the order above the cut line.
                {destructive && (
                  <span className="block mt-1 text-loss text-[11px]">
                    This bracket has recorded results or a live battle — rebuilding deletes every playoff
                    match, results included, and orphans anything being played right now.
                  </span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-text-secondary font-medium">Seeding</div>
            <Button variant="outline" size="sm" onClick={resetSeeding} className="h-6 text-[10px] px-2">
              <ListOrdered size={10} />
              Reset to standings
            </Button>
          </div>
          {seedOrder.length === 0 ? (
            <div className="text-xs text-text-muted text-center py-4">Loading standings…</div>
          ) : (
            <div className="max-h-[40dvh] overflow-y-auto rounded border border-border-subtle p-1 space-y-0.5">
              {seedOrder.map((teamId, idx) => {
                const team = teamMap.get(teamId);
                if (!team) return null;
                const inBracket = idx < topN;
                return (
                  <div key={teamId}>
                    {idx === topN && (
                      <div className="flex items-center gap-2 py-1">
                        <div className="h-px flex-1 bg-loss/40" />
                        <span className="text-[9px] font-mono uppercase tracking-wider text-loss/70">Missed playoffs</span>
                        <div className="h-px flex-1 bg-loss/40" />
                      </div>
                    )}
                    <div
                      draggable
                      onDragStart={() => setDragIdx(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={() => setDragIdx(null)}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-grab active:cursor-grabbing border',
                        dragIdx === idx ? 'bg-pink/10 border-pink/30' : 'border-transparent hover:bg-surface-overlay/40',
                        !inBracket && 'opacity-50',
                      )}
                    >
                      <GripVertical size={12} className="text-text-muted/30 shrink-0" />
                      <span className={cn(
                        'text-xs font-mono font-bold tabular-nums w-6 text-center shrink-0',
                        inBracket ? 'text-pink' : 'text-text-muted',
                      )}>
                        {inBracket ? `#${idx + 1}` : '—'}
                      </span>
                      <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
                      <span className="text-xs text-text-primary flex-1 min-w-0 truncate">{team.teamName}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-border-subtle text-text-muted font-mono shrink-0">
                        {team.record.wins}-{team.record.losses}
                      </Badge>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => moveSeed(idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                          className="h-7 w-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveSeed(idx, 1)}
                          disabled={idx === seedOrder.length - 1}
                          title="Move down"
                          className="h-7 w-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {destructive && playoffTarget && (
            <>
              <div className="text-xs text-text-secondary pt-2">
                Type the league name <span className="font-mono text-text-primary">{playoffTarget.name}</span> to confirm.
              </div>
              <Input
                value={playoffConfirmText}
                onChange={(e) => setPlayoffConfirmText(e.target.value)}
                placeholder={playoffTarget.name}
                className="bg-surface-overlay"
                autoFocus
              />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPlayoffOpen(false)}>Cancel</Button>
          <Button
            disabled={
              playoffSubmitting ||
              seedOrder.length < topN ||
              (destructive && playoffConfirmText.trim() !== playoffTarget?.name)
            }
            className={destructive
              ? 'bg-loss text-surface-base hover:bg-loss/90'
              : 'bg-pink text-surface-base hover:bg-pink/90'}
            onClick={onExecutePlayoffs}
          >
            <Trophy size={12} />
            {playoffSubmitting
              ? 'Saving…'
              : destructive
                // Not just a save — this one deletes matches and results.
                ? 'Rebuild Bracket'
                : playoffTarget?.isRegen
                  ? 'Save Seeding'
                  : 'Generate Bracket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
