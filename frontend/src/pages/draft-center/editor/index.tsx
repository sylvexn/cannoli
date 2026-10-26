import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, RotateCcw, Swords, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getErrorMessage } from '@/lib/errors';
import { useDraftCenter } from '@/lib/draft-center/store';
import { useLeagueAvailability } from '@/lib/draft-center/use-league-availability';
import { useRulesetCatalog } from '@/lib/draft-center/use-ruleset-catalog';
import { validateTeam } from '@/lib/draft-center/rules';
import type { DcMon } from '@/lib/draft-center/types';
import { preloadSprites } from '@/components/pokemon-sprite';
import { AnalysisTabs } from '../analysis/analysis-tabs';
import { RulesetSelect } from '../ruleset-select';
import { MonPicker } from './mon-picker';
import { LeagueSelect } from './avail-badge';
import { RosterList } from './roster-list';
import { SharePopover } from './share-popover';
import { BudgetMeter, Violations } from './status-bar';

export function TeamEditorPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const store = useDraftCenter();
  const team = store.getTeam(id);
  const { rulesets, resolve, loading: rulesetsLoading } = useRulesetCatalog(team ? [team] : []);
  const lg = useLeagueAvailability();
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const ruleset = useMemo(() => resolve({ rulesetId: team?.rulesetId, leagueId: team?.leagueId }), [resolve, team?.rulesetId, team?.leagueId]);
  const roster = team?.roster;
  const validation = useMemo(() => validateTeam(roster ?? [], ruleset), [roster, ruleset]);

  if (store.loading || rulesetsLoading) return <div className="p-8 text-sm text-text-muted">Loading...</div>;
  if (!team) {
    return (
      <div className="max-w-md mx-auto p-8 text-center flex flex-col gap-3">
        <p className="text-sm text-text-secondary">That team doesn't exist (or belongs to another account).</p>
        <Button nativeButton={false} render={<Link to="/draft-center" />} variant="outline">Back to Draft Center</Button>
      </div>
    );
  }

  const setRoster = (next: DcMon[]) => {
    preloadSprites(next.map(m => m.name));
    store.updateTeam(team.id, { roster: next });
  };
  const addMon = (name: string) => {
    if (team.roster.some(m => m.name === name)) return;
    setRoster([...team.roster, { name, captain: false, teraTypes: [] }]);
  };

  async function duplicate() {
    try {
      const copy = await store.duplicateTeam(team!.id);
      if (copy) { toast.success('Duplicated'); nav(`/draft-center/team/${copy.id}`); }
    } catch (e) { toast.error(getErrorMessage(e)); }
  }
  async function remove() {
    try { await store.deleteTeam(team!.id); nav('/draft-center'); } catch (e) { toast.error(getErrorMessage(e)); }
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/draft-center" />} aria-label="Back to teams"><ArrowLeft size={15} /></Button>
        <Input
          value={team.name}
          onChange={e => store.updateTeam(team.id, { name: e.target.value })}
          onBlur={() => { if (!team.name.trim()) store.updateTeam(team.id, { name: 'Untitled team' }); }}
          maxLength={60}
          aria-label="Team name"
          className="h-9 flex-1 basis-48 min-w-0 max-w-sm font-mono font-semibold text-base"
        />
        <RulesetSelect
          rulesets={rulesets}
          current={ruleset}
          onChange={rulesetId => store.updateTeam(team.id, { rulesetId, leagueId: null })}
          className="max-w-full min-w-0 basis-56"
        />
        {lg.leagues.length > 0 && (
          <LeagueSelect leagues={lg.leagues} value={lg.leagueId} onChange={lg.setLeagueId} className="max-w-full min-w-0 basis-40" />
        )}
        <span className="text-[11px] font-mono text-text-muted min-w-16" aria-live="polite">
          {store.saveError ? <span className="text-loss" title={store.saveError}>Save failed</span> : store.saving ? 'Saving...' : 'Saved'}
        </span>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/matchup?dc=${team.id}`} />}><Swords size={13} /> Matchup</Button>
          <SharePopover team={team} onSetShared={enabled => store.setShared(team.id, enabled)} />
          <Button variant="outline" size="sm" onClick={duplicate}><Copy size={13} /> Duplicate</Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)} disabled={team.roster.length === 0}><RotateCcw size={13} /> Reset</Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} className="text-loss hover:text-loss"><Trash2 size={13} /></Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-4 items-start">
        <div className="flex flex-col gap-2 min-w-0">
          <BudgetMeter v={validation} roster={team.roster} ruleset={ruleset} />
          <Violations v={validation} />
          <RosterList
            roster={team.roster} ruleset={ruleset} violations={validation.violations}
            onChange={setRoster} onAdd={() => setPicker(true)} owners={lg.owners} leagueId={lg.leagueId}
          />
        </div>
        <div className="min-w-0">
          <AnalysisTabs roster={team.roster} ruleset={ruleset} />
        </div>
      </div>

      <MonPicker
        open={picker} onOpenChange={setPicker} ruleset={ruleset}
        taken={new Set(team.roster.map(m => m.name))} remaining={validation.remaining}
        onPick={addMon} owners={lg.owners} leagueId={lg.leagueId}
      />

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset "{team.name}"?</DialogTitle>
            <DialogDescription>This removes all {team.roster.length} Pokemon and their sets from the team. The team itself is kept.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setRoster([]); setConfirmReset(false); }}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{team.name}"?</DialogTitle>
            <DialogDescription>This can't be undone{team.shareToken ? ', and its shared link will stop working' : ''}.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={remove}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
