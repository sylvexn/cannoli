/**
 * Per-pin definition card: icon, name, description, scope, how many awards the
 * active season has, and an inline edit popover (description / icon / colour /
 * scope / award inputs). Awarding itself happens in the Awards Sheet.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Pin } from '@/components/pin';
import { Pencil, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { api, type ApiPinDefinition, type PinMetadataFieldName, type PinScope } from '@/lib/api';
import { PIN_SCOPE_META } from '@/lib/constants';
import { PinIconPicker } from './pin-icon-picker';
import { ScopeFieldsEditor } from './scope-fields-editor';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface DefinitionCardProps {
  def: ApiPinDefinition;
  /** Awards (drafts included) this definition has in the active season. */
  seasonAwardCount: number;
  seasonLabel: string | null;
  onOpenSheet: () => void;
  onEdited: () => void;
}

export function DefinitionCard({
  def, seasonAwardCount, seasonLabel, onOpenSheet, onEdited,
}: DefinitionCardProps) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="rounded-md border border-border-default bg-surface-raised/50 p-3 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <Pin def={def} size="sm" noTooltip />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <div className="text-[13px] font-medium truncate" style={{ color: def.color }}>{def.name}</div>
            <span
              className="text-[8px] font-mono uppercase tracking-wider text-text-muted/70 bg-surface-overlay/40 px-1 rounded"
              title={PIN_SCOPE_META[def.scope].hint}
            >
              {def.scope}
            </span>
          </div>
          <div className="text-[10px] font-mono text-text-muted/70 uppercase tracking-wide truncate">
            {def.category} · {def.id}
          </div>
        </div>

        <Popover open={editOpen} onOpenChange={setEditOpen}>
          <PopoverTrigger
            className="inline-flex items-center justify-center h-6 w-6 shrink-0 rounded-md text-text-muted hover:bg-surface-overlay/40 hover:text-text-secondary transition-colors"
            title="Edit"
          >
            <Pencil size={11} />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-full max-w-[288px]">
            <EditPopoverBody
              def={def}
              onClose={() => setEditOpen(false)}
              onSaved={() => { setEditOpen(false); onEdited(); }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {def.description && (
        <div className="text-[11px] text-text-muted line-clamp-2">{def.description}</div>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto">
        <div className="text-[11px] text-text-secondary tabular-nums">
          <span className="font-mono font-bold">{seasonAwardCount}</span>
          {' '}awarded {seasonLabel ? `in ${seasonLabel}` : 'all-time'}
        </div>
        <Button size="sm" className="h-7 text-[11px]" onClick={onOpenSheet}>
          <Sparkles size={11} />
          Award
        </Button>
      </div>
    </div>
  );
}

function EditPopoverBody({
  def, onClose, onSaved,
}: {
  def: ApiPinDefinition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(def.description ?? '');
  const [iconName, setIconName] = useState(def.iconName);
  const [color, setColor] = useState(def.color);
  const [scope, setScope] = useState<PinScope>(def.scope);
  const [fields, setFields] = useState<PinMetadataFieldName[]>(def.metadataFields ?? []);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const colorValid = HEX_RE.test(color);
  // Keep description trimmed; trailing periods will be stripped later by the
  // 0033 migration on existing rows, but the UI no longer writes them in.
  const cleanDesc = description.trim().replace(/\.+$/, '');

  async function handleSave() {
    if (!colorValid) return;
    setSaving(true);
    try {
      await api.updatePinDefinition(def.id, {
        description: cleanDesc,
        iconName,
        color,
        scope,
        metadataFields: fields,
      });
      toast.success(`Updated '${def.id}'`);
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIconPickerOpen(true)}
          className="shrink-0 hover:opacity-80 transition-opacity"
          title="Pick icon"
        >
          <Pin def={{ id: def.id, name: def.name, iconName, color }} size="sm" noTooltip />
        </button>
        <div className="text-[11px] font-mono text-text-muted truncate">{def.id}</div>
      </div>

      <Textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Short description (no trailing period)"
        className="text-xs min-h-[60px]"
      />

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

      <ScopeFieldsEditor scope={scope} fields={fields} onScope={setScope} onFields={setFields} />

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIconPickerOpen(true)}
          className="font-mono px-1.5 py-0.5 rounded text-[11px] bg-surface-overlay/40 hover:bg-surface-overlay/70 transition-colors"
        >
          icon: {iconName}
        </button>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={handleSave} disabled={!colorValid || saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {iconPickerOpen && (
        <PinIconPicker
          value={iconName}
          onSelect={(name) => { setIconName(name); setIconPickerOpen(false); }}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
    </div>
  );
}
