import { useMemo } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { exportPaste } from '@/lib/draft-center/showdown-paste';
import type { DcMon } from '@/lib/draft-center/types';

export function PasteExportDialog({ open, onOpenChange, roster }: { open: boolean; onOpenChange: (o: boolean) => void; roster: DcMon[] }) {
  const text = useMemo(() => exportPaste(roster), [roster]);

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success('Copied to clipboard'); }
    catch { toast.error('Could not copy - select the text and copy it manually'); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Export to Showdown</DialogTitle>
          <DialogDescription>Standard Showdown team format - paste it into the teambuilder's Import.</DialogDescription>
        </DialogHeader>
        <Textarea
          readOnly value={text} onFocus={e => e.currentTarget.select()} spellCheck={false}
          className="font-mono text-xs min-h-48 max-h-[50dvh] overflow-y-auto" aria-label="Showdown team paste"
        />
        <DialogFooter>
          <Button variant="outline" nativeButton={false} render={<a href="https://sim.cannoli.live" target="_blank" rel="noreferrer" />}>
            Test it on sim.cannoli.live <ExternalLink size={13} />
          </Button>
          <Button onClick={copy} disabled={!text}><Copy size={13} /> Copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
