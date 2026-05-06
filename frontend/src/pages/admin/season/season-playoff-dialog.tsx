import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Trophy } from 'lucide-react';

interface PlayoffTarget {
  id: string;
  name: string;
  topN: number;
  isRegen: boolean;
}

interface Props {
  playoffOpen: boolean;
  setPlayoffOpen: (v: boolean) => void;
  playoffTarget: PlayoffTarget | null;
  setPlayoffTarget: (v: PlayoffTarget | null) => void;
  playoffPreview: { teamId: string; rank: number }[];
  playoffConfirmText: string;
  setPlayoffConfirmText: (v: string) => void;
  playoffSubmitting: boolean;
  onExecutePlayoffs: () => void;
}

export function SeasonPlayoffDialog({
  playoffOpen, setPlayoffOpen, playoffTarget, setPlayoffTarget,
  playoffPreview, playoffConfirmText, setPlayoffConfirmText,
  playoffSubmitting, onExecutePlayoffs,
}: Props) {
  return (
    <Dialog open={playoffOpen} onOpenChange={(o) => { if (!o) { setPlayoffOpen(false); setPlayoffTarget(null); setPlayoffConfirmText(''); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={16} className="text-pink" />
            {playoffTarget?.isRegen ? 'Regenerate Playoff Bracket' : 'Generate Playoff Bracket'}
          </DialogTitle>
          <DialogDescription>
            {playoffTarget && (
              <>
                <strong>{playoffTarget.name}</strong> — top <strong>{playoffTarget.topN}</strong> teams.
                {playoffTarget.isRegen && (
                  <span className="block mt-1 text-loss text-[11px]">
                    Regenerating will delete every existing playoff match for this league, including ones with results recorded.
                  </span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-xs text-text-secondary font-medium">Seeding preview</div>
          {playoffPreview.length === 0 ? (
            <div className="text-xs text-text-muted text-center py-4">Loading standings…</div>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto rounded border border-border-subtle">
              {playoffPreview.map(({ teamId, rank }) => (
                <div key={teamId} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <span className="font-mono text-pink w-6 text-center">#{rank}</span>
                  <span className="text-text-primary font-medium">{teamId}</span>
                </div>
              ))}
            </div>
          )}
          {playoffTarget?.isRegen && (
            <>
              <div className="text-xs text-text-secondary pt-2">
                Type the league name <span className="font-mono text-text-primary">{playoffTarget.name}</span> to confirm regeneration.
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
              playoffPreview.length === 0 ||
              (playoffTarget?.isRegen && playoffConfirmText.trim() !== playoffTarget?.name)
            }
            className={playoffTarget?.isRegen
              ? 'bg-loss text-surface-base hover:bg-loss/90'
              : 'bg-pink text-surface-base hover:bg-pink/90'}
            onClick={onExecutePlayoffs}
          >
            <Trophy size={12} />
            {playoffSubmitting
              ? 'Generating…'
              : playoffTarget?.isRegen
                ? 'Regenerate'
                : 'Generate Bracket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
