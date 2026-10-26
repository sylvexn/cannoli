import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Trophy, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AdminSection } from '../../admin-section';
import { BracketPreview } from './bracket-preview';
import { HiddenState, PublishedState } from './coach-views';
import { LEAGUE_NAME, STANDINGS, TOP_N } from './data';
import { PublishDialog } from './publish-dialog';
import { SeedEditor } from './seed-editor';
import { validate } from './validation';

type Screen = 'admin' | 'hidden' | 'coach';
type Status = 'draft' | 'published';
const SCREENS: { id: Screen; label: string }[] = [
  { id: 'admin', label: '1-2. Admin editor' },
  { id: 'hidden', label: '4. Coach: draft hidden' },
  { id: 'coach', label: '3. Coach: published' },
];

/** Clickable mockup - static data, no API. See plan/playoffs-approval-design.md. */
export function PlayoffsApprovalMockup() {
  const [order, setOrder] = useState<string[]>(STANDINGS);
  const [status, setStatus] = useState<Status>('draft');
  const [screen, setScreen] = useState<Screen>('admin');
  const [confirm, setConfirm] = useState(false);
  const warnings = useMemo(() => validate(order), [order]);
  const warnCount = warnings.filter(w => w.level === 'warn').length;
  const published = status === 'published';

  return (
    <AdminSection
      icon={Trophy}
      title="Playoffs approval (mockup)"
      actions={<Badge variant="outline" className={cn('font-mono text-[10px]', published ? 'border-win/40 text-win' : 'border-draw/40 text-draw')}>{status}</Badge>}
    >
      <div className="space-y-4">
        <nav className="flex flex-wrap gap-1 rounded-md border border-border-default p-0.5 bg-surface-base w-fit max-w-full">
          {SCREENS.map(s => (
            <button key={s.id} onClick={() => setScreen(s.id)}
              className={cn('px-2.5 py-1 min-h-7 text-[11px] font-medium rounded transition-colors',
                screen === s.id ? 'bg-surface-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {s.label}
            </button>
          ))}
        </nav>

        {screen === 'hidden' && <HiddenState />}
        {screen === 'coach' && (published
          ? <PublishedState order={order} mySeed={3} />
          : <div className="text-xs text-text-muted">Publish from the admin editor first - this screen shows what coaches get afterwards.</div>)}

        {screen === 'admin' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-medium text-text-primary">{LEAGUE_NAME}</span>
              <span className="text-text-muted">top {TOP_N} - regular season complete</span>
              {!published && <span className="text-draw flex items-center gap-1"><Info size={11} /> Draft - not visible to coaches</span>}
              {published && <span className="text-win flex items-center gap-1"><CheckCircle2 size={11} /> Published - 0 games played</span>}
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div className={cn(published && 'pointer-events-none opacity-60')}>
                <SeedEditor order={order} onChange={setOrder} />
              </div>
              <div className="space-y-3 min-w-0">
                <div>
                  <div className="text-xs text-text-secondary font-medium mb-1">Live validation</div>
                  {warnings.length === 0
                    ? <div className="text-[11px] text-win flex items-center gap-1"><CheckCircle2 size={11} /> No issues.</div>
                    : <ul className="space-y-1">{warnings.map((w, i) => (
                        <li key={i} className={cn('flex items-start gap-1.5 text-[11px] rounded border px-2 py-1',
                          w.level === 'warn' ? 'border-draw/30 bg-draw/5 text-draw' : 'border-border-subtle text-text-secondary')}>
                          {w.level === 'warn' ? <AlertTriangle size={11} className="mt-0.5 shrink-0" /> : <Info size={11} className="mt-0.5 shrink-0" />}
                          <span className="min-w-0">{w.text}</span>
                        </li>))}</ul>}
                </div>
                <div>
                  <div className="text-xs text-text-secondary font-medium mb-1">Bracket preview</div>
                  <BracketPreview order={order} />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {!published ? (
                    <Button className="bg-pink text-surface-base hover:bg-pink/90" onClick={() => setConfirm(true)}>
                      <Trophy size={12} /> Approve &amp; publish
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setStatus('draft')}>
                      <Undo2 size={12} /> Return to draft (no games played)
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <PublishDialog open={confirm} onOpenChange={setConfirm} order={order} warnings={warnCount}
        onConfirm={() => { setStatus('published'); setConfirm(false); setScreen('coach'); }} />
    </AdminSection>
  );
}
