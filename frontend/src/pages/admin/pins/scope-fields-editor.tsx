/**
 * Scope + metadata-field editor for a pin definition. Shared by the
 * new-definition dialog and the per-card edit popover so both write the same
 * `scope` / `metadataFields` the Awards Sheet reads.
 */
import { cn } from '@/lib/utils';
import { PIN_FIELD_META, PIN_SCOPE_META } from '@/lib/constants';
import type { PinMetadataFieldName, PinScope } from '@/lib/api';

const SCOPES = Object.keys(PIN_SCOPE_META) as PinScope[];
const FIELDS = Object.keys(PIN_FIELD_META) as PinMetadataFieldName[];

export function ScopeFieldsEditor({
  scope, fields, onScope, onFields,
}: {
  scope: PinScope;
  fields: PinMetadataFieldName[];
  onScope: (s: PinScope) => void;
  onFields: (f: PinMetadataFieldName[]) => void;
}) {
  const toggle = (f: PinMetadataFieldName) =>
    onFields(fields.includes(f) ? fields.filter(x => x !== f) : [...fields, f]);
  return (
    <div className="space-y-2">
      <label className="text-[11px] text-text-muted flex flex-col gap-1">
        Scope
        <select
          value={scope}
          onChange={e => onScope(e.target.value as PinScope)}
          className="h-8 rounded-md border border-border-default bg-surface-raised text-xs px-2"
        >
          {SCOPES.map(s => <option key={s} value={s}>{PIN_SCOPE_META[s].label}</option>)}
        </select>
        <span className="text-[10px] text-text-muted/80">{PIN_SCOPE_META[scope].hint}</span>
      </label>
      <div className="text-[11px] text-text-muted flex flex-col gap-1">
        Award inputs
        <div className="flex flex-wrap gap-1">
          {FIELDS.map(f => (
            <button
              key={f}
              type="button"
              onClick={() => toggle(f)}
              title={PIN_FIELD_META[f].hint}
              aria-pressed={fields.includes(f)}
              className={cn(
                'px-2 py-1 min-h-7 rounded border text-[11px] font-mono transition-colors',
                fields.includes(f)
                  ? 'border-neon/60 bg-neon/10 text-text-primary'
                  : 'border-border-default text-text-muted hover:bg-surface-overlay/40',
              )}
            >
              {PIN_FIELD_META[f].label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
