import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { AlertTriangle } from 'lucide-react';
import { phaseConfig, type EditableLeague, type Phase } from './phase-config';

interface AdvanceTarget {
  leagueId: string;
  from: Phase;
  to: Phase;
}

interface RegenTarget {
  id: string;
  name: string;
  phase: Phase;
}

interface Props {
  leagueList: EditableLeague[];
  leagueStates: Record<string, { phase: string; currentWeek: number; totalWeeks: number }>;

  // Advance Phase
  advanceOpen: boolean;
  setAdvanceOpen: (v: boolean) => void;
  advanceTarget: AdvanceTarget | null;
  onExecuteAdvance: () => void;

  // Week Advance
  weekOpen: boolean;
  setWeekOpen: (v: boolean) => void;
  weekTarget: string | null;
  onExecuteWeekAdvance: () => void;

  // Delete League
  deleteOpen: boolean;
  setDeleteOpen: (v: boolean) => void;
  deleteTarget: string | null;
  deleteConfirmText: string;
  setDeleteConfirmText: (v: string) => void;
  deleteSubmitting: boolean;
  onExecuteDeleteLeague: () => void;

  // Regen Schedule
  regenOpen: boolean;
  setRegenOpen: (v: boolean) => void;
  regenTarget: RegenTarget | null;
  regenConfirmText: string;
  setRegenConfirmText: (v: string) => void;
  regenSubmitting: boolean;
  onExecuteForcedRegen: () => void;
}

export function SeasonConfirmDialogs({
  leagueList, leagueStates,
  advanceOpen, setAdvanceOpen, advanceTarget, onExecuteAdvance,
  weekOpen, setWeekOpen, weekTarget, onExecuteWeekAdvance,
  deleteOpen, setDeleteOpen, deleteTarget, deleteConfirmText, setDeleteConfirmText, deleteSubmitting, onExecuteDeleteLeague,
  regenOpen, setRegenOpen, regenTarget, regenConfirmText, setRegenConfirmText, regenSubmitting, onExecuteForcedRegen,
}: Props) {
  return (
    <>
      {/* Advance Phase Confirmation */}
      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-draw" />
              Advance Phase
            </DialogTitle>
            <DialogDescription>
              {advanceTarget && (
                <>
                  Advance <strong>{leagueList.find(l => l.id === advanceTarget.leagueId)?.name}</strong> from{' '}
                  <strong>{phaseConfig[advanceTarget.from].label}</strong> to{' '}
                  <strong>{phaseConfig[advanceTarget.to].label}</strong>?
                  {advanceTarget.from === 'draft' && advanceTarget.to === 'regular' && (
                    <> A round-robin schedule will be generated automatically.</>
                  )}
                  {' '}This action cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceOpen(false)}>Cancel</Button>
            <Button onClick={onExecuteAdvance} className="bg-neon text-surface-base hover:bg-neon/90">
              Confirm Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Week Advance Confirmation */}
      <Dialog open={weekOpen} onOpenChange={setWeekOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Advance Week</DialogTitle>
            <DialogDescription>
              {weekTarget && (
                <>
                  Advance <strong>{leagueList.find(l => l.id === weekTarget)?.name}</strong> to{' '}
                  <strong>Week {leagueStates[weekTarget].currentWeek + 1}</strong>?
                  Ensure all match results for the current week are reported.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWeekOpen(false)}>Cancel</Button>
            <Button onClick={onExecuteWeekAdvance} className="bg-neon text-surface-base hover:bg-neon/90">
              Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete League Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!o) { setDeleteOpen(false); setDeleteConfirmText(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-loss" />
              Delete League
            </DialogTitle>
            <DialogDescription>
              {deleteTarget && (() => {
                const target = leagueList.find(l => l.id === deleteTarget);
                const phase = leagueStates[deleteTarget]?.phase as Phase | undefined;
                const isLive = phase === 'regular' || phase === 'playoffs';
                return (
                  <>
                    Permanently delete <strong>{target?.name}</strong>?
                    This removes all associated season data and cannot be undone.
                    {isLive && (
                      <span className="block mt-2 text-loss text-[11px]">
                        WARNING: This league is in <strong>{phase}</strong> phase — live trades, match results, and standings will all be wiped.
                      </span>
                    )}
                  </>
                );
              })()}
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (() => {
            const target = leagueList.find(l => l.id === deleteTarget);
            const phase = leagueStates[deleteTarget]?.phase as Phase | undefined;
            const isLive = phase === 'regular' || phase === 'playoffs';
            if (!isLive || !target) return null;
            return (
              <div className="space-y-2">
                <div className="text-xs text-text-secondary">
                  Type the league name <span className="font-mono text-text-primary">{target.name}</span> to confirm.
                </div>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={target.name}
                  className="bg-surface-overlay"
                  autoFocus
                />
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteSubmitting || (() => {
                if (!deleteTarget) return true;
                const target = leagueList.find(l => l.id === deleteTarget);
                const phase = leagueStates[deleteTarget]?.phase as Phase | undefined;
                const isLive = phase === 'regular' || phase === 'playoffs';
                return isLive && deleteConfirmText.trim() !== target?.name;
              })()}
              onClick={onExecuteDeleteLeague}
            >
              {deleteSubmitting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Regenerate Schedule Confirmation */}
      <Dialog open={regenOpen} onOpenChange={(o) => { if (!o) { setRegenOpen(false); setRegenConfirmText(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-loss" />
              Regenerate Schedule (Destructive)
            </DialogTitle>
            <DialogDescription>
              {regenTarget?.name} is in <strong>{regenTarget?.phase}</strong> phase.
              Regenerating will delete every match, including ones with results recorded.
              Standings will be reset.
            </DialogDescription>
          </DialogHeader>
          <div className="text-xs text-text-secondary">
            Type the league name <span className="font-mono text-text-primary">{regenTarget?.name}</span> to confirm.
          </div>
          <Input
            value={regenConfirmText}
            onChange={(e) => setRegenConfirmText(e.target.value)}
            placeholder={regenTarget?.name ?? ''}
            className="bg-surface-overlay"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={regenSubmitting || regenConfirmText.trim() !== regenTarget?.name}
              onClick={onExecuteForcedRegen}
            >
              {regenSubmitting ? 'Regenerating...' : 'Force Regenerate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
