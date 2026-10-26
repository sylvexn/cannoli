import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { useDraftCenter } from '@/lib/draft-center/store';
import { useRulesetCatalog } from '@/lib/draft-center/use-ruleset-catalog';
import { importPrompted, markImportPrompted } from '@/lib/draft-center/local-store';
import { preloadSprites } from '@/components/pokemon-sprite';
import { NewTeamDialog } from './new-team-dialog';
import { PastTeams } from './past-teams';
import { TeamCard } from './team-card';

export function DraftCenterHome() {
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const store = useDraftCenter();
  const { rulesets, resolve } = useRulesetCatalog(store.teams);
  const [creating, setCreating] = useState(false);
  const [askImport, setAskImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<'mine' | 'past'>('mine');

  // On login with guest teams still in this browser, ask whether to bring them along.
  useEffect(() => {
    if (isAuthenticated && !store.loading && store.localCount > 0 && !importPrompted()) {
      markImportPrompted();
      setAskImport(true);
    }
  }, [isAuthenticated, store.loading, store.localCount]);

  useEffect(() => { preloadSprites(store.teams.flatMap(t => t.roster.map(m => m.name))); }, [store.teams]);

  // First active-season instance, else the built-in default.
  const defaultRulesetId = rulesets.find(r => !r.isTemplate)?.id ?? null;
  const defaultName = useMemo(() => `Team ${store.teams.length + 1}`, [store.teams.length]);

  async function create(name: string, rulesetId: number | null) {
    try {
      const t = await store.createTeam({ name, rulesetId, roster: [] });
      setCreating(false);
      nav(`/draft-center/team/${t.id}`);
    } catch (e) { toast.error(getErrorMessage(e)); }
  }

  async function doImport() {
    setImporting(true);
    try {
      const n = await store.importLocal();
      toast.success(`Imported ${n} team${n === 1 ? '' : 's'}`);
      setAskImport(false);
    } catch (e) { toast.error(getErrorMessage(e)); } finally { setImporting(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={tab} onValueChange={v => setTab(v as 'mine' | 'past')}>
        <div className="flex items-center gap-2 flex-wrap">
          <TabsList variant="line">
            <TabsTrigger value="mine">My teams{store.teams.length > 0 && <span className="ml-1 text-[10px] text-text-muted">{store.teams.length}</span>}</TabsTrigger>
            <TabsTrigger value="past">Past teams</TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {isAuthenticated && store.localCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => setAskImport(true)}>
                <Download size={13} /> Import {store.localCount} local
              </Button>
            )}
            <Button size="sm" onClick={() => setCreating(true)}><Plus size={13} /> New team</Button>
          </div>
        </div>

        <TabsContent value="mine" className="mt-3">
          {!isAuthenticated && (
            <div className="mb-3 rounded-lg border border-border-default bg-surface-raised/40 px-3 py-2 text-xs text-text-secondary">
              Your teams are saved in this browser only. <Link to="/login" className="text-neon hover:underline">Log in</Link> to keep them on your account and share them.
            </div>
          )}
          {store.saveError && <div className="mb-3 text-xs text-loss">{store.saveError}</div>}
          {store.loading ? (
            <div className="p-8 text-sm text-text-muted">Loading...</div>
          ) : store.teams.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-default p-10 text-center flex flex-col items-center gap-3">
              <p className="text-sm text-text-secondary max-w-md">
                Sketch what your team could look like - check budget, type weaknesses, speed and move roles before the draft or a trade.
                Start blank, or clone a real team from <button type="button" className="text-neon hover:underline" onClick={() => setTab('past')}>Past teams</button>.
              </p>
              <Button onClick={() => setCreating(true)}><Plus size={14} /> New team</Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
              {store.teams.map(t => (
                <TeamCard
                  key={t.id} team={t} ruleset={resolve(t)}
                  onDuplicate={() => store.duplicateTeam(t.id).then(() => toast.success('Duplicated')).catch(e => toast.error(getErrorMessage(e)))}
                  onDelete={() => { if (window.confirm(`Delete "${t.name}"?`)) store.deleteTeam(t.id).catch(e => toast.error(getErrorMessage(e))); }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="past" className="mt-3"><PastTeams /></TabsContent>
      </Tabs>

      <NewTeamDialog
        open={creating} onOpenChange={setCreating} rulesets={rulesets}
        defaultRulesetId={defaultRulesetId} defaultName={defaultName} onCreate={create}
      />

      <Dialog open={askImport} onOpenChange={setAskImport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import {store.localCount} local team{store.localCount === 1 ? '' : 's'} to your account?</DialogTitle>
            <DialogDescription>
              You built {store.localCount === 1 ? 'a team' : 'teams'} in this browser before logging in. Importing adds {store.localCount === 1 ? 'it' : 'them'} to your account and removes the local copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAskImport(false)}>Not now</Button>
            <Button onClick={doImport} disabled={importing}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
