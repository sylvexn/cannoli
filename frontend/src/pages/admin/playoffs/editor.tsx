import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Loader2, Trash2, Trophy, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';
import { playoffsApi, type PlayoffDraftView } from '@/lib/api-playoffs';
import { BracketPreview } from './bracket-preview';
import { PublishDialog } from './publish-dialog';
import { SeedEditor } from './seed-editor';

const SAVE_DELAY_MS = 500;

/** Seeding editor for one league. Edits autosave to the draft; the server returns live validation. */
export function PlayoffEditor({ leagueId, onBack }: { leagueId: string; onBack: () => void }) {
  const [view, setView] = useState<PlayoffDraftView | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [topN, setTopN] = useState(6);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback((v: PlayoffDraftView) => {
    setView(v); setOrder(v.seedOrder); setTopN(v.topN);
  }, []);

  useEffect(() => {
    playoffsApi.getDraft(leagueId).then(apply).catch(e => toast.error(getErrorMessage(e)));
    return () => clearTimeout(timer.current);
  }, [leagueId, apply]);

  // Debounced save; a stale response (older seq) is dropped so fast edits never snap back.
  const save = useCallback((nextOrder: string[], nextTopN: number, immediate = false) => {
    setOrder(nextOrder); setTopN(nextTopN);
    clearTimeout(timer.current);
    const run = async () => {
      const mine = ++seq.current;
      setSaving(true);
      try {
        const v = await playoffsApi.saveDraft(leagueId, { topN: nextTopN, seedOrder: nextOrder });
        if (mine === seq.current) setView(v);
      } catch (e) { toast.error(getErrorMessage(e)); }
      finally { if (mine === seq.current) setSaving(false); }
    };
    if (immediate) void run(); else timer.current = setTimeout(run, SAVE_DELAY_MS);
  }, [leagueId]);

  async function act(fn: () => Promise<string | void>) {
    setBusy(true);
    clearTimeout(timer.current);
    try {
      const msg = await fn();
      if (msg) toast.success(msg);
      apply(await playoffsApi.getDraft(leagueId));
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBusy(false); setPublishOpen(false); setUnpublishOpen(false); }
  }

  if (!view) return <div className="p-4 text-xs text-text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading...</div>;

  const published = view.status === 'published';
  const none = view.status === 'none';
  const warnCount = view.warnings.filter(w => w.level === 'warn').length;
  const sizes = view.bracketSizes.filter(n => n <= view.standings.length);
  const canPublish = !none && !published && view.phase === 'playoffs' && !view.legacyBracket && !saving;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={onBack}><ArrowLeft size={12} /> All leagues</Button>
        <span className="font-medium text-text-primary">{view.leagueName}</span>
        <Badge variant="outline" className={cn('font-mono text-[10px]', published ? 'border-win/40 text-win' : 'border-draw/40 text-draw')}>
          {none ? 'no draft' : view.status}
        </Badge>
        {saving && <span className="text-text-muted flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving</span>}
        {!none && !published && <span className="text-draw flex items-center gap-1"><Info size={11} /> Draft - not visible to coaches</span>}
        {published && <span className="text-win flex items-center gap-1"><CheckCircle2 size={11} /> Published{view.locked ? ' - games started, read-only' : ' - no games played'}</span>}
      </div>

      {view.phase !== 'playoffs' && (
        <div className="rounded border border-border-subtle px-3 py-2 text-[11px] text-text-secondary">
          League is in the <b>{view.phase}</b> phase. You can prepare a draft now; publishing needs the playoffs phase.
        </div>
      )}
      {view.legacyBracket && (
        <div className="rounded border border-draw/30 bg-draw/5 px-3 py-2 text-[11px] text-draw">
          A bracket already exists for this league (generated before approval drafts). Manage it from the{' '}
          <Link to="/admin/season" className="underline">Season tab</Link>.
        </div>
      )}

      {none ? (
        <div className="rounded-md border border-border-default p-4 space-y-2">
          <div className="text-xs text-text-secondary">No draft yet. Create one from the current standings, then arrange the seeds.</div>
          <Button className="bg-pink text-surface-base hover:bg-pink/90" disabled={view.legacyBracket}
            onClick={() => save(view.seedOrder, view.topN, true)}>
            <Trophy size={12} /> Create draft from standings
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <SeedEditor leagueId={leagueId} order={order} topN={topN} standings={view.standings}
            disabled={published || busy} onChange={o => save(o, topN)} />
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-text-secondary font-medium">Bracket size</span>
              <div className="flex rounded-md border border-border-default p-0.5 bg-surface-base">
                {sizes.map(n => (
                  <button key={n} disabled={published || busy} onClick={() => save(order, n)}
                    className={cn('px-2.5 min-h-7 text-[11px] font-mono rounded transition-colors disabled:opacity-50',
                      n === topN ? 'bg-surface-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-secondary font-medium mb-1">Live validation</div>
              {view.warnings.length === 0
                ? <div className="text-[11px] text-win flex items-center gap-1"><CheckCircle2 size={11} /> No issues.</div>
                : <ul className="space-y-1">{view.warnings.map((w, i) => (
                    <li key={i} className={cn('flex items-start gap-1.5 text-[11px] rounded border px-2 py-1',
                      w.level === 'warn' ? 'border-draw/30 bg-draw/5 text-draw' : 'border-border-subtle text-text-secondary')}>
                      {w.level === 'warn' ? <AlertTriangle size={11} className="mt-0.5 shrink-0" /> : <Info size={11} className="mt-0.5 shrink-0" />}
                      <span className="min-w-0">{w.text}</span>
                    </li>))}</ul>}
            </div>
            <div>
              <div className="text-xs text-text-secondary font-medium mb-1">Bracket preview</div>
              <BracketPreview order={order} topN={topN} standings={view.standings} />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {!published ? (
                <>
                  <Button className="bg-pink text-surface-base hover:bg-pink/90" disabled={!canPublish || busy} onClick={() => setPublishOpen(true)}>
                    <Trophy size={12} /> Approve &amp; publish
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => act(async () => {
                    await playoffsApi.discardDraft(leagueId); onBack(); return 'Draft discarded';
                  })}>
                    <Trash2 size={12} /> Discard draft
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={view.locked || busy} onClick={() => setUnpublishOpen(true)}>
                  <Undo2 size={12} /> {view.locked ? 'Locked - a game has started' : 'Return to draft (no games played)'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} order={order} topN={topN}
        standings={view.standings} warnings={warnCount} busy={busy}
        onConfirm={() => act(async () => {
          const r = await playoffsApi.publish(leagueId);
          return `Bracket published - ${r.notified} coach${r.notified === 1 ? '' : 'es'} notified`;
        })} />

      <Dialog open={unpublishOpen} onOpenChange={setUnpublishOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return bracket to draft?</DialogTitle>
            <DialogDescription>
              The bracket disappears for coaches and unread &quot;Playoffs are set&quot; notifications are removed. Notifications already read stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnpublishOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => act(async () => {
              const r = await playoffsApi.unpublish(leagueId);
              return `Returned to draft (${r.removedNotifications} notification${r.removedNotifications === 1 ? '' : 's'} retracted)`;
            })}>Return to draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
