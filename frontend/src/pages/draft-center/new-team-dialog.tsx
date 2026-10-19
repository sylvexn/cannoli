import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { League } from '@/lib/types';
import { RulesetSelect } from './ruleset-select';

/** Blank-team creation: a name and the ruleset (league) to check against. */
export function NewTeamDialog({ open, onOpenChange, leagues, defaultLeagueId, defaultName, onCreate }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leagues: League[];
  defaultLeagueId: string | null;
  defaultName: string;
  onCreate: (name: string, leagueId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [leagueId, setLeagueId] = useState<string | null>(defaultLeagueId);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (o) { setName(defaultName); setLeagueId(defaultLeagueId); } }}>
      <DialogContent className="max-w-md">
        <form
          className="contents"
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            try { await onCreate(name.trim() || defaultName, leagueId); } finally { setBusy(false); }
          }}
        >
          <DialogHeader>
            <DialogTitle>New team</DialogTitle>
            <DialogDescription>Pick the ruleset to check against - costs, bans, budget and roster size come from that league.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase text-text-muted">Name</span>
            <Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={60} />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-mono uppercase text-text-muted">Ruleset</span>
            <RulesetSelect leagues={leagues} value={leagueId} onChange={setLeagueId} className="w-full" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
