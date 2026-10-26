import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ApiRuleset } from '@/lib/api';
import { resolveTeamRuleset } from '@/lib/draft-center/ruleset';
import { importPaste } from '@/lib/draft-center/showdown-paste';
import type { DcMon } from '@/lib/draft-center/types';
import { PasteField } from './editor/paste-import-dialog';
import { RulesetSelect } from './ruleset-select';

/** Blank-team creation: a name and the ruleset to check against. */
export function NewTeamDialog({ open, onOpenChange, rulesets, defaultRulesetId, defaultName, onCreate }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rulesets: ApiRuleset[];
  defaultRulesetId: number | null;
  defaultName: string;
  onCreate: (name: string, rulesetId: number | null, roster: DcMon[]) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [rulesetId, setRulesetId] = useState<number | null>(defaultRulesetId);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (o) { setName(defaultName); setRulesetId(defaultRulesetId); setPaste(''); setShowPaste(false); } }}>
      <DialogContent className="max-w-md">
        <form
          className="contents"
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            try { await onCreate(name.trim() || defaultName, rulesetId, importPaste(paste).mons); } finally { setBusy(false); }
          }}
        >
          <DialogHeader>
            <DialogTitle>New team</DialogTitle>
            <DialogDescription>Pick the ruleset to check against - costs, bans, budget, captains and roster size come from it.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase text-text-muted">Name</span>
            <Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={60} />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-mono uppercase text-text-muted">Ruleset</span>
            <RulesetSelect rulesets={rulesets} current={resolveTeamRuleset({ rulesetId }, { rulesets, leagueRulesets: {}, leagues: [] })} onChange={setRulesetId} className="w-full" />
          </label>
          <button type="button" onClick={() => setShowPaste(v => !v)} className="flex items-center gap-1 text-[11px] font-mono uppercase text-text-muted hover:text-text-secondary self-start">
            <ChevronDown size={12} className={showPaste ? '' : '-rotate-90'} /> Start from a Showdown paste
          </button>
          {showPaste && <PasteField text={paste} onText={setPaste} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
