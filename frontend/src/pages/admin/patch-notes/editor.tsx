/**
 * PatchEditor — edit one patch or hotfix: version, title, hero, one textarea per
 * section (one bullet per line), live preview, then save draft / publish.
 */
import { useState } from 'react';
import { Eye, Pencil, Save, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PatchView } from '@/components/patch-notes/patch-view';
import { api, type ApiAdminPatchNote, type PatchSection, type PatchSectionKind } from '@/lib/api';
import { PATCH_SECTION_META, PATCH_SECTION_ORDER } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errors';

export interface EditTarget {
  /** Existing row, or null when composing a new one. */
  row: ApiAdminPatchNote | null;
  /** Set when composing a hotfix under this patch. */
  parent: ApiAdminPatchNote | null;
}

type Texts = Record<PatchSectionKind, string>;

function toTexts(sections: PatchSection[]): Texts {
  const t: Texts = { new: '', changes: '', fixes: '', balance: '' };
  for (const s of sections) t[s.kind] = s.items.join('\n');
  return t;
}
function toSections(t: Texts): PatchSection[] {
  return PATCH_SECTION_ORDER
    .map(kind => ({ kind, items: t[kind].split('\n').map(l => l.trim().replace(/^[-*]\s+/, '')).filter(Boolean) }))
    .filter(s => s.items.length > 0);
}

interface Props {
  target: EditTarget;
  onDone: () => void;
  onCancel: () => void;
}

export function PatchEditor({ target, onDone, onCancel }: Props) {
  const { row, parent } = target;
  const [version, setVersion] = useState(row?.version ?? '');
  const [title, setTitle] = useState(row?.title ?? '');
  const [heroUrl, setHeroUrl] = useState(row?.heroUrl ?? '');
  const [texts, setTexts] = useState<Texts>(toTexts(row?.sections ?? []));
  const [busy, setBusy] = useState(false);

  const isPublished = row?.status === 'published';
  const sections = toSections(texts);
  const canSave = title.trim().length > 0 && !busy;

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    try { await fn(); toast.success(okMsg); onDone(); }
    catch (e) { toast.error(getErrorMessage(e, 'Save failed')); }
    finally { setBusy(false); }
  }

  const payload = () => ({
    version: version.trim(), title: title.trim(), heroUrl: heroUrl.trim(), sections,
  });

  /** Persist the form; returns the row id (creating a draft first when new). */
  async function save(): Promise<string> {
    if (row) { await api.adminUpdatePatchNote(row.id, payload()); return row.id; }
    return (await api.adminCreatePatchNote({ ...payload(), parentId: parent?.id ?? null, status: 'draft' })).id;
  }

  const preview = {
    id: row?.id ?? 'preview', version: version.trim() || null, title: title.trim() || 'Untitled',
    date: row?.date ?? new Date().toISOString(), heroUrl: heroUrl.trim() || null, sections,
    parentId: parent?.id ?? row?.parentId ?? null, status: row?.status ?? ('draft' as const),
  };

  return (
    <div className="space-y-4 rounded-lg border border-border-default bg-surface-raised p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">
          {row ? `Edit ${row.version ? `v${row.version}` : row.title}` : parent ? `New hotfix for v${parent.version ?? parent.title}` : 'New patch'}
        </h3>
        {row && (
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${isPublished ? 'bg-neon/20 text-neon' : 'bg-amber-400/20 text-amber-400'}`}>
            {row.status}
          </span>
        )}
      </div>

      <Tabs defaultValue="edit" className="space-y-3">
        <TabsList className="h-8">
          <TabsTrigger value="edit" className="h-7 gap-1 px-3 text-xs"><Pencil size={12} />Edit</TabsTrigger>
          <TabsTrigger value="preview" className="h-7 gap-1 px-3 text-xs"><Eye size={12} />Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="mt-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <label className="space-y-1 text-xs text-text-muted">
              Version
              <Input value={version} onChange={e => setVersion(e.target.value)} placeholder={parent ? '1.3.1' : '1.3'} className="font-mono" />
            </label>
            <label className="min-w-0 space-y-1 text-xs text-text-muted">
              Title / theme
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Approvals, tera preview & standings fixes" />
            </label>
          </div>
          <label className="block space-y-1 text-xs text-text-muted">
            Hero image URL (optional)
            <Input value={heroUrl} onChange={e => setHeroUrl(e.target.value)} placeholder="https://… or /uploads/…" />
          </label>
          {PATCH_SECTION_ORDER.map(kind => {
            const meta = PATCH_SECTION_META[kind];
            return (
              <label key={kind} className="block space-y-1 text-xs">
                <span className="flex items-center gap-1.5 font-semibold" style={{ color: meta.color }}>
                  <meta.Icon size={12} />{meta.label}
                  <span className="font-normal text-text-muted">one bullet per line</span>
                </span>
                <Textarea
                  value={texts[kind]}
                  onChange={e => setTexts(prev => ({ ...prev, [kind]: e.target.value }))}
                  rows={Math.max(3, texts[kind].split('\n').length)}
                  className="text-sm"
                />
              </label>
            );
          })}
        </TabsContent>

        <TabsContent value="preview" className="mt-0">
          <PatchView patch={preview} draft={!isPublished} />
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm" variant="outline" disabled={!canSave}
          onClick={() => run(save, isPublished ? 'Changes saved' : 'Draft saved')}
        >
          <Save size={13} />{isPublished ? 'Save changes' : 'Save draft'}
        </Button>
        {!isPublished && (
          <Button
            size="sm" disabled={!canSave || sections.length === 0}
            onClick={() => {
              if (!confirm('Publish now? Players will see this on the Patch Notes page.')) return;
              run(async () => { await api.adminPublishPatchNote(await save()); }, 'Published');
            }}
          >
            <Send size={13} />Publish
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        {row && (
          <Button
            size="sm" variant="ghost" className="ml-auto text-red-400 hover:text-red-300" disabled={busy}
            onClick={() => {
              if (!confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
              run(() => api.adminDeletePatchNote(row.id), 'Deleted');
            }}
          >
            <Trash2 size={13} />Delete
          </Button>
        )}
      </div>
    </div>
  );
}
