/**
 * Admin Pins surface — re-exports the redesigned single-tab `PinsTab`
 * (lives in `./pins/index.tsx`) and keeps the "new definition" dialog
 * available so the rest of the admin can spawn it without dragging in the
 * full pins folder.
 *
 * Old structure (Definitions sub-tab + Award sub-tab) is gone. Per-card
 * inline edit replaces the Definitions tab; the per-pin metadata-aware
 * dialog replaces the Award tab.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { ApiPinDefinition, PinCategory } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Pin } from '@/components/pin';
import { PinIconPicker, RECENT_LUCIDE_NAMES } from './pins/pin-icon-picker';

export { PinsTab } from './pins';

const CATEGORIES: PinCategory[] = ['career', 'season', 'week', 'draft', 'community', 'custom'];

// `id` slug input mirrors the backend regex: kebab-case, lowercase letters/
// digits, hyphen separators only, max 64.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Dialog for creating a brand-new pin definition. Opened from the "New Pin"
 * button on the redesigned Pins tab. Edits to existing defs use the inline
 * popover on each card instead — slugs are immutable once created so the
 * "edit" code path doesn't need this full dialog any more.
 */
export function NewDefinitionDialog({
  onClose, onSaved,
}: {
  onClose: () => void;
  onSaved: (def: ApiPinDefinition) => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconName, setIconName] = useState(RECENT_LUCIDE_NAMES[0]);
  const [color, setColor] = useState('#fbbf24');
  const [category, setCategory] = useState<PinCategory>('custom');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const idValid = SLUG_RE.test(id);
  const colorValid = HEX_RE.test(color);
  const canSave = idValid && colorValid && !!name.trim();

  // Strip a trailing period before saving — site convention is no trailing
  // periods on pin descriptions (matches migration 0033's cleanup of
  // existing rows).
  const cleanDesc = description.trim().replace(/\.+$/, '');

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.createPinDefinition({ id, name: name.trim(), description: cleanDesc, iconName, color, category });
      toast.success(`Created pin '${id}'`);
      onSaved({
        id, name: name.trim(), description: cleanDesc, iconName, color, category,
        isAuto: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Save failed';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New pin definition</DialogTitle>
          <DialogDescription>
            Auto pins are seeded by code. Custom pins live here forever — give the slug some thought.
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
            placeholder="Short description (no trailing period)"
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
