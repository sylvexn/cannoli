import { Bell, BellOff, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TeamLogo } from '@/components/team-logo';
import { PLAYOFF_WEEK, STANDINGS, TEAM_BY_ID, TOP_N } from './data';
import { R1 } from './validation';

/** The line a coach gets. Shared with the coach-view screen so both always agree. */
export function notificationFor(order: string[], seed: number) {
  const opp = (() => {
    for (const [a, b] of R1) {
      if (a === seed) return { name: TEAM_BY_ID.get(order[b - 1])!.name, week: PLAYOFF_WEEK };
      if (b === seed) return { name: TEAM_BY_ID.get(order[a - 1])!.name, week: PLAYOFF_WEEK };
    }
    return null;
  })();
  return opp
    ? { title: `Playoffs are set - you're the #${seed} seed`, body: `Round 1 (week ${opp.week}) vs ${opp.name}.` }
    : { title: `Playoffs are set - you're the #${seed} seed`, body: `First-round bye. You play the winner of ${seed === 1 ? 'QF1' : 'QF2'} in week ${PLAYOFF_WEEK + 1}.` };
}

export function PublishDialog({ open, onOpenChange, order, onConfirm, warnings }: {
  open: boolean; onOpenChange: (o: boolean) => void; order: string[]; onConfirm: () => void; warnings: number;
}) {
  const skipped = STANDINGS.length - TOP_N;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Trophy size={16} className="text-pink" /> Approve &amp; publish bracket</DialogTitle>
          <DialogDescription>
            The bracket becomes public and {TOP_N} coaches are notified. Until then nobody but staff can see it.
          </DialogDescription>
        </DialogHeader>
        {warnings > 0 && (
          <div className="rounded border border-draw/30 bg-draw/5 px-3 py-2 text-[11px] text-draw">
            {warnings} unresolved warning{warnings > 1 ? 's' : ''} - you can still publish.
          </div>
        )}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted"><Bell size={11} /> Will be notified ({TOP_N})</div>
          <ul className="max-h-[36dvh] overflow-y-auto space-y-1">
            {order.slice(0, TOP_N).map((id, i) => {
              const t = TEAM_BY_ID.get(id)!;
              const n = notificationFor(order, i + 1);
              return (
                <li key={id} className="flex items-start gap-2 rounded border border-border-subtle px-2 py-1.5">
                  <TeamLogo abbrev={t.abbrev} color={t.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-text-primary truncate">{t.coach} <span className="text-text-muted">({t.name})</span></div>
                    <div className="text-[11px] text-text-secondary">{n.body}</div>
                  </div>
                  <span className="text-[10px] font-mono text-pink shrink-0">#{i + 1}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted pt-1"><BellOff size={11} /> {skipped} other coaches get nothing.</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Back to draft</Button>
          <Button className="bg-pink text-surface-base hover:bg-pink/90" onClick={onConfirm}>
            <Trophy size={12} /> Publish &amp; notify {TOP_N} coaches
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
