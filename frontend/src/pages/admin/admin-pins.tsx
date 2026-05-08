import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSprite } from '@/components/loading-sprite';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { ApiPinDefinition, ApiPinRecent, ApiAuthUser, PinCategory } from '@/lib/api';
import { Plus, Pencil, Trash2, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Pin } from '@/components/pin';
import { EmptyState } from '@/components/empty-state';
import { formatPinMetadata } from '@/lib/pin-metadata-schema';
import { PinIconPicker, RECENT_LUCIDE_NAMES } from './pins/pin-icon-picker';

const CATEGORIES: PinCategory[] = ['career', 'season', 'week', 'draft', 'community', 'custom'];

// `id` slug input mirrors the backend regex: kebab-case, lowercase letters/
// digits, hyphen separators only, max 64.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ─── Definitions sub-tab ────────────────────────────────────────────────

export function DefinitionsTab() {
  const [defs, setDefs] = useState<ApiPinDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ApiPinDefinition | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getPinDefinitions()
      .then(setDefs)
      .catch(() => toast.error('Failed to load pin definitions'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search) return defs;
    const q = search.toLowerCase();
    return defs.filter(d =>
      d.id.includes(q) || d.name.toLowerCase().includes(q) || d.category.includes(q),
    );
  }, [defs, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search definitions"
            className="pl-7 h-7 text-xs"
          />
        </div>
        <Button size="sm" onClick={() => setCreating(true)} className="h-7">
          <Plus size={12} />
          New Pin
        </Button>
      </div>

      {loading ? (
        <LoadingSprite size="sm" padding="sm" />
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="nothing-here"
          title="No pin definitions match."
          spriteSize="md"
          padding="sm"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map(def => (
            <DefinitionCard key={def.id} def={def} onEdit={() => setEditing(def)} />
          ))}
        </div>
      )}

      {creating && (
        <DefinitionDialog
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {editing && (
        <DefinitionDialog
          mode="edit"
          def={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function DefinitionCard({ def, onEdit }: { def: ApiPinDefinition; onEdit: () => void }) {
  return (
    <div className="rounded-md border border-border-default bg-surface-raised/50 p-2.5 flex items-center gap-3">
      <Pin def={def} size="sm" noTooltip />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <div className="text-[13px] font-medium truncate" style={{ color: def.color }}>{def.name}</div>
          {def.isAuto && (
            <span className="text-[8px] font-mono uppercase tracking-wider text-text-muted/70 bg-surface-overlay/40 px-1 rounded">
              auto
            </span>
          )}
        </div>
        <div className="text-[10px] font-mono text-text-muted/70 uppercase tracking-wide">
          {def.category} · {def.id}
        </div>
        {def.description && (
          <div className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{def.description}</div>
        )}
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onEdit} title="Edit">
        <Pencil size={11} />
      </Button>
    </div>
  );
}

function DefinitionDialog({
  mode, def, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  def?: ApiPinDefinition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id, setId] = useState(def?.id ?? '');
  const [name, setName] = useState(def?.name ?? '');
  const [description, setDescription] = useState(def?.description ?? '');
  const [iconName, setIconName] = useState(def?.iconName ?? RECENT_LUCIDE_NAMES[0]);
  const [color, setColor] = useState(def?.color ?? '#fbbf24');
  const [category, setCategory] = useState<PinCategory>((def?.category as PinCategory) ?? 'custom');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const idValid = mode === 'edit' || SLUG_RE.test(id);
  const colorValid = HEX_RE.test(color);
  const canSave = idValid && colorValid && !!name.trim();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      if (mode === 'create') {
        await api.createPinDefinition({ id, name: name.trim(), description: description.trim(), iconName, color, category });
        toast.success(`Created pin '${id}'`);
      } else if (def) {
        await api.updatePinDefinition(def.id, { name: name.trim(), description: description.trim(), iconName, color, category });
        toast.success(`Updated pin '${def.id}'`);
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New pin definition' : `Edit '${def?.id}'`}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? "Auto pins are seeded by code. Custom pins live here forever — give the slug some thought."
              : 'Slugs are immutable; everything else can change.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIconPickerOpen(true)}
              className="shrink-0 hover:opacity-80 transition-opacity"
              title="Pick icon"
            >
              <Pin def={{ id, name: name || 'Preview', iconName, color }} size="lg" noTooltip />
            </button>
            <div className="flex-1 grid grid-cols-1 gap-2">
              <Input
                value={id}
                onChange={e => setId(e.target.value)}
                disabled={mode === 'edit'}
                placeholder="slug-id"
                className={cn('h-8 text-xs font-mono', !idValid && id ? 'border-loss' : undefined)}
              />
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Display name"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Short description shown in tooltips"
            className="text-xs min-h-[60px]"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-text-muted flex flex-col gap-1">
              Color
              <div className="flex gap-1">
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="h-8 w-10 rounded border border-border-default bg-transparent cursor-pointer"
                />
                <Input
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className={cn('h-8 text-xs font-mono', !colorValid ? 'border-loss' : undefined)}
                />
              </div>
            </label>
            <label className="text-[11px] text-text-muted flex flex-col gap-1">
              Category
              <select
                value={category}
                onChange={e => setCategory(e.target.value as PinCategory)}
                className="h-8 rounded-md border border-border-default bg-surface-raised text-xs px-2"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <div className="text-[11px] text-text-muted flex items-center gap-2">
            <span>Icon:</span>
            <button
              type="button"
              onClick={() => setIconPickerOpen(true)}
              className="font-mono px-1.5 py-0.5 rounded bg-surface-overlay/40 hover:bg-surface-overlay/70 transition-colors"
            >
              {iconName}
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving} size="sm">
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>

        {iconPickerOpen && (
          <PinIconPicker
            value={iconName}
            onSelect={(name) => { setIconName(name); setIconPickerOpen(false); }}
            onClose={() => setIconPickerOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Award sub-tab ──────────────────────────────────────────────────────

export function AwardTab() {
  const [users, setUsers] = useState<ApiAuthUser[]>([]);
  const [defs, setDefs] = useState<ApiPinDefinition[]>([]);
  const [recent, setRecent] = useState<ApiPinRecent[]>([]);
  const [loading, setLoading] = useState(true);

  const [userId, setUserId] = useState<number | null>(null);
  const [pinDefId, setPinDefId] = useState<string>('');
  const [seasonId, setSeasonId] = useState<string>('');
  const [metadataText, setMetadataText] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getUsers(),
      api.getPinDefinitions(),
      api.getRecentPins(50),
    ])
      .then(([u, d, r]) => { setUsers(u); setDefs(d); setRecent(r); })
      .catch(() => toast.error('Failed to load award data'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredUsers = useMemo(() => {
    if (!userSearch) return users.slice(0, 25);
    const q = userSearch.toLowerCase();
    return users.filter(u => u.username.toLowerCase().includes(q)).slice(0, 25);
  }, [users, userSearch]);

  const selectedDef = useMemo(() => defs.find(d => d.id === pinDefId), [defs, pinDefId]);
  const selectedUser = useMemo(() => users.find(u => parseInt(u.id) === userId), [users, userId]);

  async function handleAward() {
    if (!userId || !pinDefId) return;
    let metadata: Record<string, unknown> | undefined;
    if (metadataText.trim()) {
      try {
        const parsed = JSON.parse(metadataText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed;
        else { toast.error('Metadata must be a JSON object'); return; }
      } catch {
        toast.error('Metadata must be valid JSON');
        return;
      }
    }
    const seasonNum = seasonId.trim() ? parseInt(seasonId.trim()) : null;
    if (seasonId.trim() && (seasonNum == null || !Number.isFinite(seasonNum))) {
      toast.error('Season id must be a number'); return;
    }

    setSubmitting(true);
    try {
      await api.awardPin({ userId, pinDefId, metadata, seasonId: seasonNum });
      toast.success(`Awarded '${selectedDef?.name ?? pinDefId}' to ${selectedUser?.username}`);
      setMetadataText('');
      load();
    } catch (err: any) {
      toast.error(err.message ?? 'Award failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: number) {
    if (!confirm('Revoke this pin?')) return;
    try {
      await api.revokePin(id);
      toast.success('Pin revoked');
      load();
    } catch (err: any) {
      toast.error(err.message ?? 'Revoke failed');
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Award form */}
      <div className="space-y-3 rounded-md border border-border-default bg-surface-raised/30 p-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-text-secondary">Award a pin</h3>

        <div className="space-y-1">
          <div className="text-[11px] text-text-muted">User</div>
          <Input
            value={userSearch}
            onChange={e => { setUserSearch(e.target.value); setUserId(null); }}
            placeholder="Search by username"
            className="h-8 text-xs"
          />
          {userSearch && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-border-default bg-surface-base">
              {filteredUsers.length === 0 ? (
                <div className="text-[11px] text-text-muted px-2 py-1">No matches</div>
              ) : filteredUsers.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { setUserId(parseInt(u.id)); setUserSearch(u.username); }}
                  className={cn(
                    'w-full text-left px-2 py-1 text-xs hover:bg-surface-overlay/40 transition-colors flex items-center justify-between',
                    userId === parseInt(u.id) && 'bg-surface-overlay/60',
                  )}
                >
                  <span className="font-mono">{u.username}</span>
                  <span className="text-[10px] uppercase text-text-muted">{u.role}</span>
                </button>
              ))}
            </div>
          )}
          {selectedUser && !userSearch && (
            <div className="text-[11px] text-win">Selected: {selectedUser.username}</div>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-text-muted">Pin definition</div>
          <select
            value={pinDefId}
            onChange={e => setPinDefId(e.target.value)}
            className="w-full h-8 rounded-md border border-border-default bg-surface-raised text-xs px-2"
          >
            <option value="">Select a pin...</option>
            {defs.map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.category})</option>
            ))}
          </select>
          {selectedDef && (
            <div className="flex items-center gap-2 mt-1">
              <Pin def={selectedDef} size="sm" noTooltip />
              <span className="text-[11px] text-text-muted line-clamp-2">{selectedDef.description}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-text-muted flex flex-col gap-1">
            Season ID (optional)
            <Input
              value={seasonId}
              onChange={e => setSeasonId(e.target.value)}
              placeholder="e.g. 11"
              className="h-8 text-xs font-mono"
            />
          </label>
          <label className="text-[11px] text-text-muted flex flex-col gap-1">
            Metadata JSON (optional)
            <Input
              value={metadataText}
              onChange={e => setMetadataText(e.target.value)}
              placeholder='{"pokemon":"..."}'
              className="h-8 text-xs font-mono"
            />
          </label>
        </div>

        <Button
          onClick={handleAward}
          disabled={!userId || !pinDefId || submitting}
          size="sm"
          className="w-full"
        >
          <Sparkles size={12} />
          {submitting ? 'Awarding...' : 'Award pin'}
        </Button>
      </div>

      {/* Recent awards list */}
      <div className="space-y-2 rounded-md border border-border-default bg-surface-raised/30 p-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-text-secondary">Recently awarded</h3>
        {loading ? (
          <LoadingSprite size="sm" padding="sm" />
        ) : recent.length === 0 ? (
          <EmptyState
            variant="quiet"
            title="No pins awarded yet."
            spriteSize="md"
            padding="sm"
          />
        ) : (
          <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
            {recent.map(r => {
              const detail = formatPinMetadata(r.pinDefId, r.metadata);
              return (
                <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-overlay/30 transition-colors">
                  <Pin
                    def={{ id: r.pinDefId, name: r.defName, iconName: r.defIconName, color: r.defColor }}
                    size="sm"
                    noTooltip
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] truncate">
                      <span style={{ color: r.defColor }}>{r.defName}</span>
                      <span className="text-text-muted"> → </span>
                      <span className="font-mono">{r.username}</span>
                    </div>
                    {detail && (
                      <div className="text-[11px] text-text-secondary truncate italic">{detail}</div>
                    )}
                    <div className="text-[10px] text-text-muted">
                      {r.awardedBy ? 'manual' : 'auto'}
                      {r.seasonId != null && ` · Earned S${r.seasonId}`}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-text-muted hover:text-loss"
                    onClick={() => handleRevoke(r.id)}
                    title="Revoke"
                  >
                    <Trash2 size={11} />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
