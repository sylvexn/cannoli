import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { PatchView, PatchAnchor } from '@/components/patch-notes/patch-view';
import { usePatchNotes } from '@/lib/use-patch-notes';

/** Public, linkable patch notes. Opening the page marks everything seen. */
export function PatchNotesPage() {
  const { patches, seenAt, loaded, markSeen } = usePatchNotes();
  const { hash } = useLocation();
  // Snapshot the seen stamp from before this visit so "New" badges survive markSeen().
  const priorSeen = useRef<string | null | undefined>(undefined);
  if (loaded && priorSeen.current === undefined) priorSeen.current = seenAt;

  useEffect(() => { if (loaded) markSeen(); }, [loaded, markSeen]);

  useEffect(() => {
    if (!loaded || !hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el instanceof HTMLDetailsElement) el.open = true; // hotfix anchors land on a collapsed <details>
    el?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);

  const isNew = (date: string) => priorSeen.current !== undefined && (!priorSeen.current || date > priorSeen.current);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-neon">Patch</span>{' '}
          <span className="text-text-primary">Notes</span>
        </h1>
        <p className="text-sm text-text-muted">What changed in Cannoli, newest first.</p>
      </div>

      {!loaded ? (
        <LoadingSprite />
      ) : patches.length === 0 ? (
        <EmptyState variant="nothing-here" title="No patch notes yet" subtitle="Check back after the next release." />
      ) : (
        <>
          {patches.length > 1 && (
            <nav className="flex flex-wrap gap-1.5" aria-label="Jump to version">
              {patches.filter(p => p.version).map(p => <PatchAnchor key={p.id} version={p.version!} />)}
            </nav>
          )}
          <div className="space-y-4">
            {patches.map(p => <PatchView key={p.id} patch={p} isNew={isNew(p.date)} />)}
          </div>
        </>
      )}
    </div>
  );
}
