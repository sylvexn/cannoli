import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { rulesetsApi, type ApiRuleset } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { RulesetEditor } from './editor';
import { summarize } from './form';

type Filter = 'template' | 'instance';

function Row({ r, onEdit, onClone, onDelete }: {
  r: ApiRuleset; onEdit: () => void; onClone: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle px-3 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm text-text-primary truncate min-w-0">{r.name}</span>
          {r.frozen && <Badge variant="outline" className="gap-1 text-[10px] text-draw border-draw/30 shrink-0"><Lock size={9} />Frozen</Badge>}
          {r.archived && <Badge variant="outline" className="text-[10px] shrink-0">Archived</Badge>}
        </div>
        <div className="text-[10px] font-mono text-text-muted truncate">{summarize(r)}</div>
      </div>
      <div className="flex flex-wrap gap-1 min-w-0">
        {r.usedBy.map(l => <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>)}
        {r.draftCenterTeams > 0 && <Badge variant="outline" className="text-[10px] text-text-muted">{r.draftCenterTeams} DC</Badge>}
      </div>
      <div className="flex gap-1 shrink-0">
        <Button size="icon" variant="ghost" className="size-7" title="Edit" onClick={onEdit}><Pencil size={13} /></Button>
        <Button size="icon" variant="ghost" className="size-7" title="Clone as template" onClick={onClone}><Copy size={13} /></Button>
        <Button size="icon" variant="ghost" className="size-7" title="Delete" onClick={onDelete}
          disabled={r.usedBy.length > 0}><Trash2 size={13} /></Button>
      </div>
    </div>
  );
}

/**
 * Ruleset library. `basePath` is where edit links go (route mode); inside the
 * Settings Console it is omitted and the editor opens inline.
 */
export function RulesetsAdmin({ basePath }: { basePath?: string }) {
  const params = useParams();
  const navigate = useNavigate();
  const [all, setAll] = useState<ApiRuleset[] | null>(null);
  const [filter, setFilter] = useState<Filter>('template');
  const [inlineId, setInlineId] = useState<number | 'new' | null>(null);

  const load = useCallback(() => {
    rulesetsApi.list().then(setAll).catch(e => { toast.error(getErrorMessage(e)); setAll([]); });
  }, []);
  useEffect(load, [load]);

  const routeId = params.id ? Number(params.id) : null;
  const editing = routeId ?? inlineId;
  const current = typeof editing === 'number' ? (all?.find(r => r.id === editing) ?? null) : null;

  function open(id: number | 'new') {
    if (basePath) navigate(`${basePath}/${id}`); else setInlineId(id);
  }
  function close() {
    setInlineId(null);
    if (basePath && params.id) navigate(basePath);
  }

  async function clone(r: ApiRuleset) {
    try { const c = await rulesetsApi.clone(r.id); toast.success(`Cloned as "${c.name}"`); load(); open(c.id); }
    catch (e) { toast.error(getErrorMessage(e)); }
  }
  async function remove(r: ApiRuleset) {
    if (!window.confirm(`Delete "${r.name}"?`)) return;
    try { await rulesetsApi.remove(r.id); load(); } catch (e) { toast.error(getErrorMessage(e)); }
  }

  if (!all) return <div className="text-sm text-text-muted">Loading rulesets...</div>;

  if (editing !== null && (editing === 'new' || current)) {
    return (
      <RulesetEditor
        ruleset={editing === 'new' ? null : current}
        onSaved={r => { load(); if (editing === 'new') open(r.id); }}
        onCancel={close}
      />
    );
  }
  if (editing !== null) return <div className="text-sm text-text-muted">Ruleset not found. <button className="underline" onClick={close}>Back</button></div>;

  const shown = all.filter(r => (filter === 'template' ? r.isTemplate : !r.isTemplate));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-border-default p-0.5 bg-surface-base">
          {(['template', 'instance'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2.5 py-0.5 text-[11px] font-medium rounded ${filter === f ? 'bg-surface-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
              {f === 'template' ? 'Templates' : 'League instances'}
            </button>
          ))}
        </div>
        <Button size="sm" className="ml-auto gap-1.5 bg-neon text-surface-base hover:bg-neon/90" onClick={() => open('new')}>
          <Plus size={13} />New template
        </Button>
      </div>
      {shown.length === 0 && <div className="text-sm text-text-muted">Nothing here yet.</div>}
      <div className="space-y-1.5">
        {shown.map(r => <Row key={r.id} r={r} onEdit={() => open(r.id)} onClone={() => clone(r)} onDelete={() => remove(r)} />)}
      </div>
    </div>
  );
}
