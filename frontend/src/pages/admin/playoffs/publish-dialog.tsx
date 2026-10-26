import { Bell, BellOff, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TeamLogo } from '@/components/team-logo';
import { roundOnePairs, type PlayoffStandingRow } from '@/lib/api-playoffs';

/** What the coach's notification will say (client mirror of the backend body). */
function lineFor(seed: number, topN: number, name: (seed: number) => string): string {
  for (const [a, b] of roundOnePairs(topN)) {
    if (a === seed) return `Plays #${b} ${name(b)}.`;
    if (b === seed) return `Plays #${a} ${name(a)}.`;
  }
  return 'First-round bye.';
}

export function PublishDialog({ open, onOpenChange, order, topN, standings, warnings, busy, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; order: string[]; topN: number;
  standings: PlayoffStandingRow[]; warnings: number; busy: boolean; onConfirm: () => void;
}) {
  const byId = new Map(standings.map(t => [t.teamId, t]));
  const seeded = order.slice(0, topN).map(id => byId.get(id)!).filter(Boolean);
  const notified = seeded.filter(t => t.hasCoach).length;
  const name = (seed: number) => seeded[seed - 1]?.teamName ?? 'TBD';
  const others = standings.length - topN;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Trophy size={16} className="text-pink" /> Approve &amp; publish bracket</DialogTitle>
          <DialogDescription>
            The bracket becomes public and {notified} coach{notified === 1 ? '' : 'es'} will be notified. Until then nobody but staff can see it.
          </DialogDescription>
        </DialogHeader>
        {warnings > 0 && (
          <div className="rounded border border-draw/30 bg-draw/5 px-3 py-2 text-[11px] text-draw">
            {warnings} unresolved warning{warnings > 1 ? 's' : ''} - you can still publish.
          </div>
        )}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted"><Bell size={11} /> Will be notified ({notified})</div>
          <ul className="max-h-[36dvh] overflow-y-auto space-y-1">
            {seeded.map((t, i) => (
              <li key={t.teamId} className="flex items-start gap-2 rounded border border-border-subtle px-2 py-1.5">
                <TeamLogo abbrev={t.abbrev} color={t.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-primary truncate">{t.coachName} <span className="text-text-muted">({t.teamName})</span></div>
                  <div className="text-[11px] text-text-secondary">{t.hasCoach ? lineFor(i + 1, topN, name) : 'No coach linked - nobody to notify.'}</div>
                </div>
                <span className="text-[10px] font-mono text-pink shrink-0">#{i + 1}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted pt-1">
            <BellOff size={11} /> {others} other team{others === 1 ? '' : 's'} get nothing.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Back to draft</Button>
          <Button className="bg-pink text-surface-base hover:bg-pink/90" disabled={busy} onClick={onConfirm}>
            <Trophy size={12} /> Publish &amp; notify {notified} coach{notified === 1 ? '' : 'es'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
