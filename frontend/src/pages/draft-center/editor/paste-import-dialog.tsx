import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { importPaste } from '@/lib/draft-center/showdown-paste';
import type { DcMon } from '@/lib/draft-center/types';

/** Live parse of a paste: textarea + preview of parsed mons and warnings. */
export function PasteField({ text, onText, autoFocus }: { text: string; onText: (t: string) => void; autoFocus?: boolean }) {
  const { mons, warnings } = useMemo(() => importPaste(text), [text]);
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <Textarea
        autoFocus={autoFocus} value={text} onChange={e => onText(e.target.value)}
        placeholder="Paste a Pokemon Showdown team here..." spellCheck={false}
        className="font-mono text-xs min-h-40 max-h-[40dvh] overflow-y-auto"
        aria-label="Showdown team paste"
      />
      {text.trim() && (
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="text-text-secondary">
            <span className="font-mono text-neon">{mons.length}</span> Pokemon: {mons.map(m => m.name).join(', ') || 'none'}
          </div>
          {warnings.length > 0 && (
            <ul className="flex flex-col gap-0.5 max-h-28 overflow-y-auto text-[11px] text-text-muted">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5"><AlertTriangle size={11} className="shrink-0 mt-0.5 text-amber-400" />{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function PasteImportDialog({ open, onOpenChange, roster, onApply }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roster: DcMon[];
  onApply: (next: DcMon[]) => void;
}) {
  const [text, setText] = useState('');
  const { mons } = useMemo(() => importPaste(text), [text]);
  const fresh = mons.filter(m => !roster.some(r => r.name === m.name));
  const close = () => { onOpenChange(false); setText(''); };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) setText(''); onOpenChange(o); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from Showdown</DialogTitle>
          <DialogDescription>Paste a team in Showdown export format. Captains are not set automatically.</DialogDescription>
        </DialogHeader>
        <PasteField text={text} onText={setText} autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button variant="outline" disabled={!fresh.length} onClick={() => { onApply([...roster, ...fresh]); close(); }}>
            Append{fresh.length ? ` (${fresh.length})` : ''}
          </Button>
          <Button disabled={!mons.length} onClick={() => { onApply(mons); close(); }}>Replace roster</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
