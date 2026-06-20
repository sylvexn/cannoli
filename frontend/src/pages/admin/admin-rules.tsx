/**
 * Admin Rules editor.
 *
 * Lets admins write a plain-text "Additional Notes" block that appears at the
 * top of the public /rules page. Newlines are preserved (whitespace-pre-line).
 * Clearing the field and saving removes the block entirely.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LoadingSprite } from '@/components/loading-sprite';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { Save, Trash2, Loader2, Eye, EyeOff } from 'lucide-react';

const MAX_CHARS = 8_000;

export function AdminRules() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.getRules()
      .then(r => {
        const v = r.rulesText ?? '';
        setText(v);
        setSaved(v);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isDirty = text !== saved;
  const charCount = text.length;

  async function handleSave() {
    setSaving(true);
    try {
      const value = text.trim() || null;
      await api.saveRules(value);
      setSaved(text);
      toast.success(value ? 'Rules text saved' : 'Custom rules text cleared');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    setText('');
  }

  if (loading) {
    return <LoadingSprite label="Loading rules..." />;
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <p className="text-xs text-text-muted leading-relaxed">
          Write an "Additional Notes" block that appears at the top of the public{' '}
          <span className="font-mono text-neon">/rules</span> page.
          Plain text — newlines are preserved. Leave blank to hide the block.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPreview(p => !p)}
          className="h-7 gap-1.5 text-[11px] text-text-muted"
        >
          {preview ? <EyeOff size={13} /> : <Eye size={13} />}
          {preview ? 'Edit' : 'Preview'}
        </Button>
        <span className="ml-auto text-[10px] font-mono tabular-nums text-text-muted">
          {charCount}/{MAX_CHARS}
        </span>
      </div>

      {preview ? (
        /* ── Preview pane ── */
        <div className="min-h-[200px] rounded-lg border border-border-subtle bg-surface-raised px-4 py-3">
          {text.trim() ? (
            <p className="text-xs text-text-secondary whitespace-pre-line leading-relaxed">
              {text}
            </p>
          ) : (
            <p className="text-xs text-text-muted italic">
              (no content — block will not appear on the rules page)
            </p>
          )}
        </div>
      ) : (
        /* ── Editor ── */
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
          placeholder="Write any additional notes, format clarifications, or season-specific rules here…"
          rows={12}
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted leading-relaxed outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y font-mono"
          spellCheck
        />
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-border-subtle">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={saving || !text}
          className="h-7 gap-1.5 text-[11px] text-text-muted hover:text-loss"
        >
          <Trash2 size={13} />
          Clear
        </Button>

        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="ml-auto h-7 gap-1.5 text-[11px] bg-neon text-surface-base hover:bg-neon/90"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
