/**
 * AdminPatchNotes — list of patches (hotfixes nested) with draft / published
 * state, plus the editor. Flow: New patch -> write -> Preview -> Publish.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, GitBranchPlus, Newspaper } from 'lucide-react';
import { AdminSection } from '../admin-section';
import { Button } from '@/components/ui/button';
import { LoadingSprite } from '@/components/loading-sprite';
import { api, type ApiAdminPatchNote } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { PatchEditor, type EditTarget } from './editor';

function StatusChip({ status }: { status: ApiAdminPatchNote['status'] }) {
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${status === 'published' ? 'bg-neon/20 text-neon' : 'bg-amber-400/20 text-amber-400'}`}>
      {status}
    </span>
  );
}

function AdminPatchNotes() {
  const [rows, setRows] = useState<ApiAdminPatchNote[] | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const load = useCallback(() => {
    api.adminListPatchNotes().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const tree = useMemo(() => {
    const all = rows ?? [];
    return all.filter(r => !r.parentId).map(p => ({ p, kids: all.filter(k => k.parentId === p.id) }));
  }, [rows]);

  if (!rows) return <LoadingSprite />;

  const line = (r: ApiAdminPatchNote, extra?: React.ReactNode) => (
    <div className="flex items-center gap-2 px-3 py-2">
      {r.version && <span className="font-mono text-xs font-bold text-neon">v{r.version}</span>}
      <span className="min-w-0 truncate text-sm text-text-primary">{r.title}</span>
      <StatusChip status={r.status} />
      <time className="ml-auto hidden shrink-0 text-[11px] text-text-muted tabular-nums sm:block">{formatDate(r.date)}</time>
      <Button size="sm" variant="ghost" className="shrink-0" title="Edit" onClick={() => setEditing({ row: r, parent: null })}>
        <Pencil size={13} />
      </Button>
      {extra}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="min-w-0 text-xs text-text-muted">
          Drafts are staff-only. Publishing stamps the date to now, which lights the sidebar badge for every player who hasn't seen it. Hotfixes nest under their patch and don't add a badge.
        </p>
        <Button size="sm" className="ml-auto shrink-0" onClick={() => setEditing({ row: null, parent: null })}>
          <Plus size={13} />New patch
        </Button>
      </div>

      {editing && (
        <PatchEditor
          key={editing.row?.id ?? `new-${editing.parent?.id ?? 'top'}`}
          target={editing}
          onCancel={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); }}
        />
      )}

      <div className="divide-y divide-border-default/60 rounded-lg border border-border-default bg-surface-raised">
        {tree.length === 0 && <div className="px-3 py-6 text-center text-xs text-text-muted">No patch notes yet.</div>}
        {tree.map(({ p, kids }) => (
          <div key={p.id}>
            {line(p, (
              <Button
                size="sm" variant="ghost" className="shrink-0" title="Add hotfix"
                disabled={p.status !== 'published'}
                onClick={() => setEditing({ row: null, parent: p })}
              >
                <GitBranchPlus size={13} />
              </Button>
            ))}
            {kids.map(k => (
              <div key={k.id} className="ml-4 border-l border-border-default/60 bg-surface-overlay/20">{line(k)}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export const AdminPatchNotesRoute = () => (
  <AdminSection icon={Newspaper} title="Patch Notes"><AdminPatchNotes /></AdminSection>
);
