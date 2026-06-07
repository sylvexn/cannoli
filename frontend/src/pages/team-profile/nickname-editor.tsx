import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const MAX_LENGTH = 40;

interface NicknameEditorProps {
  teamId: string;
  rosterId: number | undefined;
  pokemonName: string;
  currentNickname: string | null;
  onSaved: (next: string | null) => void;
}

export function NicknameEditor({
  teamId, rosterId, pokemonName, currentNickname, onSaved,
}: NicknameEditorProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentNickname ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(currentNickname ?? '');
    }
  }, [open, currentNickname]);

  if (rosterId == null) return null;

  async function commit(next: string | null) {
    if (rosterId == null) return;
    setSaving(true);
    try {
      const res = await api.setRosterNickname(teamId, rosterId, next);
      onSaved(res.nickname ?? null);
      setOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save nickname';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    const trimmed = value.trim();
    void commit(trimmed.length === 0 ? null : trimmed);
  }

  function handleClear() {
    void commit(null);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-neon transition-opacity p-0.5 rounded"
        aria-label={`Edit nickname for ${pokemonName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Pencil size={11} />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64">
        <div className="text-[11px] font-heading uppercase tracking-wider text-text-muted">
          Nickname for {pokemonName}
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_LENGTH))}
          placeholder={pokemonName}
          maxLength={MAX_LENGTH}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          }}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="text-[10px] font-mono text-text-muted/70 text-right">
          {value.length}/{MAX_LENGTH}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving || !currentNickname}
            onClick={handleClear}
            className="text-loss hover:text-loss"
          >
            Clear
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
