import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { api, type ApiDraftTemplate } from '@/lib/api';
import { DRAFT_FORMATS, type DraftFormat } from '@/data/pokemon-learnsets';
import { useFormatDate } from '@/lib/format';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Pencil, X, Layers } from 'lucide-react';

const FORMAT_LABELS: Record<DraftFormat, string> = {
  gen9natdex: 'Gen 9 NatDex',
  gen9ou: 'Gen 9 OU',
  gen9uu: 'Gen 9 UU',
  gen9ru: 'Gen 9 RU',
  gen9nu: 'Gen 9 NU',
  gen9pu: 'Gen 9 PU',
  gen9lc: 'Gen 9 LC',
  gen9ubers: 'Gen 9 Ubers',
};

interface EditState {
  /** When `null`, dialog is creating a brand-new template. Otherwise we're
   *  editing the row that has this id. */
  id: number | null;
  name: string;
  description: string;
  format: DraftFormat;
  captainCount: number;
  pointCap: number;
  rosterSize: number;
  /** Comma-separated banlist editor — kept as text so the admin can paste. */
  banlistText: string;
  teraBanlistText: string;
}

function emptyEdit(): EditState {
  return {
    id: null,
    name: '',
    description: '',
    format: 'gen9natdex',
    captainCount: 2,
    pointCap: 110,
    rosterSize: 11,
    banlistText: '',
    teraBanlistText: '',
  };
}

function parseList(s: string): string[] {
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

export function AdminTemplates() {
  const [templates, setTemplates] = useState<ApiDraftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const formatDate = useFormatDate();

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      setTemplates(await api.listDraftTemplates());
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEdit(emptyEdit());
  }

  function openEdit(t: ApiDraftTemplate) {
    setEdit({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      format: (t.format as DraftFormat) ?? 'gen9natdex',
      captainCount: t.captainCount,
      pointCap: t.pointCap,
      rosterSize: t.rosterSize,
      banlistText: t.banlist.join(', '),
      teraBanlistText: t.teraBanlist.join(', '),
    });
  }

  async function snapshotTierList(): Promise<{ tier: number; names: string[] }[]> {
    // Snapshot the live tier list at save time. We bucket by tier number so the
    // template stores the same shape the season wizard / league seeder expects.
    const rows = await api.getTierList();
    const byTier = new Map<number, string[]>();
    for (const r of rows) {
      if (!byTier.has(r.tier)) byTier.set(r.tier, []);
      byTier.get(r.tier)!.push(r.name);
    }
    return [...byTier.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([tier, names]) => ({ tier, names: names.sort() }));
  }

  async function handleSave() {
    if (!edit) return;
    if (!edit.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (edit.id == null) {
        const snapshot = await snapshotTierList();
        await api.createDraftTemplate({
          name: edit.name.trim(),
          description: edit.description.trim() || null,
          format: edit.format,
          tierListSnapshot: snapshot,
          banlist: parseList(edit.banlistText),
          teraBanlist: parseList(edit.teraBanlistText),
          captainCount: edit.captainCount,
          pointCap: edit.pointCap,
          rosterSize: edit.rosterSize,
        });
        toast.success(`Created template "${edit.name.trim()}"`);
      } else {
        await api.updateDraftTemplate(edit.id, {
          name: edit.name.trim(),
          description: edit.description.trim() || null,
          format: edit.format,
          banlist: parseList(edit.banlistText),
          teraBanlist: parseList(edit.teraBanlistText),
          captainCount: edit.captainCount,
          pointCap: edit.pointCap,
          rosterSize: edit.rosterSize,
        });
        toast.success(`Updated template "${edit.name.trim()}"`);
      }
      setEdit(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t: ApiDraftTemplate) {
    if (!confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteDraftTemplate(t.id);
      toast.success(`Deleted "${t.name}"`);
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? 'Delete failed');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSprite />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted max-w-2xl">
          Templates snapshot the tier list, format, banlist, and captain config so a
          new season can spin up from a known-good preset. Apply one in the
          season wizard's first step.
        </p>
        <Button
          size="sm"
          onClick={openCreate}
          className="bg-neon text-surface-base hover:bg-neon/90"
        >
          <Plus size={14} />
          New Template
        </Button>
      </div>

      {/* List */}
      {templates.length === 0 ? (
        <EmptyState
          variant="nothing-here"
          title="No templates yet"
          subtitle="Create one to capture the current tier list + format settings as a reusable preset."
        />
      ) : (
        <div className="grid gap-3">
          {templates.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              onEdit={() => openEdit(t)}
              onDelete={() => handleDelete(t)}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!edit} onOpenChange={v => { if (!v) setEdit(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers size={16} className="text-neon" />
              {edit?.id == null ? 'New Template' : 'Edit Template'}
            </DialogTitle>
            <DialogDescription>
              {edit?.id == null
                ? 'A snapshot of the current tier list will be saved with this template.'
                : 'The tier-list snapshot is fixed at create time and cannot be edited here.'}
            </DialogDescription>
          </DialogHeader>

          {edit && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Name</label>
                <Input
                  value={edit.name}
                  onChange={e => setEdit({ ...edit, name: e.target.value })}
                  placeholder="e.g. S10 Standard NatDex"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Description (optional)</label>
                <Input
                  value={edit.description}
                  onChange={e => setEdit({ ...edit, description: e.target.value })}
                  placeholder="Notes for future admins"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-text-muted">Battle Format</label>
                  <Select
                    value={edit.format}
                    onValueChange={v => setEdit({ ...edit, format: v as DraftFormat })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DRAFT_FORMATS.map(f => (
                        <SelectItem key={f} value={f} className="text-xs">{FORMAT_LABELS[f]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-text-muted">Captain Count</label>
                  <NumberInput
                    value={edit.captainCount}
                    onChange={v => setEdit({ ...edit, captainCount: v })}
                    min={0}
                    max={6}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-text-muted">Point Cap</label>
                  <NumberInput
                    value={edit.pointCap}
                    onChange={v => setEdit({ ...edit, pointCap: v })}
                    min={50}
                    max={200}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-text-muted">Roster Size</label>
                  <NumberInput
                    value={edit.rosterSize}
                    onChange={v => setEdit({ ...edit, rosterSize: v })}
                    min={6}
                    max={20}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">
                  Draft Banlist <span className="text-text-muted/60">(comma-separated Pokemon names)</span>
                </label>
                <Input
                  value={edit.banlistText}
                  onChange={e => setEdit({ ...edit, banlistText: e.target.value })}
                  placeholder="Annihilape, Espathra"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">
                  Tera Banlist <span className="text-text-muted/60">(comma-separated)</span>
                </label>
                <Input
                  value={edit.teraBanlistText}
                  onChange={e => setEdit({ ...edit, teraBanlistText: e.target.value })}
                  placeholder="Garchomp, Salamence"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)} disabled={saving}>
              <X size={12} />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !edit?.name.trim()}
              className="bg-neon text-surface-base hover:bg-neon/90"
            >
              <Save size={14} />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({
  template, onEdit, onDelete, formatDate,
}: {
  template: ApiDraftTemplate;
  onEdit: () => void;
  onDelete: () => void;
  formatDate: (iso: string) => string;
}) {
  const speciesCount = useMemo(
    () => template.tierListSnapshot.reduce((sum, t) => sum + t.names.length, 0),
    [template.tierListSnapshot],
  );
  const formatLabel = (FORMAT_LABELS as Record<string, string>)[template.format] ?? template.format;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary truncate">{template.name}</h3>
              <Badge variant="outline" className="text-[10px] border-neon/30 text-neon bg-neon/5">
                {formatLabel}
              </Badge>
            </div>
            {template.description && (
              <p className="text-xs text-text-muted mt-1">{template.description}</p>
            )}
            <div className="flex flex-wrap gap-3 text-[11px] text-text-muted mt-2">
              <Stat label="Tier list">{speciesCount} species</Stat>
              <Stat label="Captains">{template.captainCount}</Stat>
              <Stat label="Point cap">{template.pointCap}</Stat>
              <Stat label="Roster size">{template.rosterSize}</Stat>
              {template.banlist.length > 0 && (
                <Stat label="Banlist">{template.banlist.length}</Stat>
              )}
              {template.teraBanlist.length > 0 && (
                <Stat label="Tera bans">{template.teraBanlist.length}</Stat>
              )}
            </div>
            {template.createdAt && (
              <div className="text-[10px] text-text-muted/70 mt-2 font-mono">
                Created {formatDate(template.createdAt)}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <Button size="xs" variant="outline" onClick={onEdit}>
              <Pencil size={11} />
              Edit
            </Button>
            <Button size="xs" variant="ghost" onClick={onDelete} className="text-loss hover:bg-loss/10">
              <Trash2 size={11} />
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span>
      <span className="text-text-muted/70 mr-1">{label}:</span>
      <span className="text-text-secondary tabular-nums">{children}</span>
    </span>
  );
}
