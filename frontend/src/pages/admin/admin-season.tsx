import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import {
  ChevronRight, Play, SkipForward, AlertTriangle,
  Sparkles, Plus, Pencil, Trash2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { PHASES, phaseConfig, getNextPhase, PRESET_COLORS, type EditableLeague, type Phase } from './season/phase-config';
import { LeagueEditDialog } from './season/league-edit-dialog';
import { NewSeasonWizard } from './season/new-season-wizard';
import { DraftOrderEditor } from './season/draft-order-editor';

export function AdminSeason() {
  const { leagues: defaultLeagues } = useAppData();

  // Editable league list (source of truth for the whole tab)
  const [leagueList, setLeagueList] = useState<EditableLeague[]>(
    defaultLeagues.map(l => ({ id: l.id, name: l.name, color: l.color }))
  );

  const [leagueStates, setLeagueStates] = useState(
    Object.fromEntries(defaultLeagues.map(l => [l.id, { ...l.season }]))
  );

  // Advance phase confirmation
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<{ leagueId: string; from: Phase; to: Phase } | null>(null);

  // Week advance confirmation
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekTarget, setWeekTarget] = useState<string | null>(null);

  // New season wizard
  const [wizardOpen, setWizardOpen] = useState(false);

  // League edit dialog
  const [leagueEditOpen, setLeagueEditOpen] = useState(false);
  const [editingLeague, setEditingLeague] = useState<EditableLeague | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // Delete league confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function confirmAdvance(league: EditableLeague) {
    const state = leagueStates[league.id];
    const next = getNextPhase(state.phase as Phase);
    if (!next) return;
    setAdvanceTarget({ leagueId: league.id, from: state.phase as Phase, to: next });
    setAdvanceOpen(true);
  }

  function executeAdvance() {
    if (!advanceTarget) return;
    const { leagueId, to } = advanceTarget;
    setLeagueStates(prev => ({
      ...prev,
      [leagueId]: {
        ...prev[leagueId],
        phase: to,
        currentWeek: to === 'regular' ? 1 : to === 'playoffs' ? 0 : prev[leagueId].currentWeek,
      },
    }));
    const name = leagueList.find(l => l.id === leagueId)?.name;
    toast.success(`${name} advanced to ${phaseConfig[to].label}`);
    setAdvanceOpen(false);
    setAdvanceTarget(null);
  }

  function confirmWeekAdvance(leagueId: string) {
    setWeekTarget(leagueId);
    setWeekOpen(true);
  }

  function executeWeekAdvance() {
    if (!weekTarget) return;
    setLeagueStates(prev => ({
      ...prev,
      [weekTarget]: {
        ...prev[weekTarget],
        currentWeek: prev[weekTarget].currentWeek + 1,
      },
    }));
    const name = leagueList.find(l => l.id === weekTarget)?.name;
    const newWeek = leagueStates[weekTarget].currentWeek + 1;
    toast.success(`${name} advanced to Week ${newWeek}`);
    setWeekOpen(false);
    setWeekTarget(null);
  }

  // League CRUD
  function openNewLeague() {
    setEditingLeague(null);
    setEditName('');
    setEditColor(PRESET_COLORS.find(c => !leagueList.some(l => l.color === c)) ?? PRESET_COLORS[0]);
    setLeagueEditOpen(true);
  }

  function openEditLeague(league: EditableLeague) {
    setEditingLeague(league);
    setEditName(league.name);
    setEditColor(league.color);
    setLeagueEditOpen(true);
  }

  function saveLeague() {
    const name = editName.trim();
    if (!name) return;

    if (editingLeague) {
      setLeagueList(prev => prev.map(l =>
        l.id === editingLeague.id ? { ...l, name, color: editColor } : l
      ));
      toast.success(`Updated "${name}"`);
    } else {
      const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (leagueList.some(l => l.id === id)) {
        toast.error('A league with this name already exists');
        return;
      }
      setLeagueList(prev => [...prev, { id, name, color: editColor }]);
      setLeagueStates(prev => ({
        ...prev,
        [id]: { id: `s10-${id}`, seasonNumber: 10, phase: 'offseason' as const, currentWeek: 0, totalWeeks: 11 },
      }));
      toast.success(`Created "${name}"`);
    }
    setLeagueEditOpen(false);
  }

  function confirmDeleteLeague(id: string) {
    setDeleteTarget(id);
    setDeleteOpen(true);
  }

  function executeDeleteLeague() {
    if (!deleteTarget) return;
    const name = leagueList.find(l => l.id === deleteTarget)?.name;
    setLeagueList(prev => prev.filter(l => l.id !== deleteTarget));
    setLeagueStates(prev => {
      const next = { ...prev };
      delete next[deleteTarget];
      return next;
    });
    toast.success(`Deleted "${name}"`);
    setDeleteOpen(false);
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Current Season:</span>
          <span className="text-text-primary font-medium font-mono">10</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Leagues:</span>
          <span className="text-text-primary font-medium font-mono">{leagueList.length}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={openNewLeague}>
            <Plus size={14} />
            Add League
          </Button>
          <Button size="sm" onClick={() => setWizardOpen(true)} className="bg-pink text-surface-base hover:bg-pink/90">
            <Sparkles size={14} />
            New Season
          </Button>
        </div>
      </div>

      {/* League phase cards */}
      <div className="space-y-3">
        {leagueList.map(league => {
          const state = leagueStates[league.id];
          if (!state) return null;
          const phase = state.phase as Phase;
          const config = phaseConfig[phase];
          const nextPhase = getNextPhase(phase);
          const Icon = config.icon;
          const isRegular = phase === 'regular';
          const atWeekLimit = isRegular && state.currentWeek >= state.totalWeeks;

          return (
            <Card key={league.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
                  <CardTitle className="text-base flex-1">{league.name}</CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={config.color}>
                      <Icon size={12} />
                      {config.label}
                    </Badge>
                    <button
                      onClick={() => openEditLeague(league)}
                      className="p-1 rounded hover:bg-surface-overlay transition-colors text-text-muted hover:text-text-primary"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => confirmDeleteLeague(league.id)}
                      className="p-1 rounded hover:bg-loss/10 transition-colors text-text-muted hover:text-loss"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Phase timeline */}
                <div className="flex items-center gap-1">
                  {PHASES.map((p, i) => {
                    const isCurrent = p === phase;
                    const isPast = PHASES.indexOf(p) < PHASES.indexOf(phase);
                    const pConfig = phaseConfig[p];
                    return (
                      <div key={p} className="flex items-center gap-1 flex-1">
                        <div className={`flex-1 h-1.5 rounded-full transition-colors ${
                          isCurrent ? pConfig.color.split(' ')[1] : isPast ? 'bg-win/30' : 'bg-surface-overlay'
                        }`} />
                        {i < PHASES.length - 1 && (
                          <ChevronRight size={10} className={`shrink-0 ${isPast || isCurrent ? 'text-text-secondary' : 'text-text-muted/30'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1 justify-between text-[10px] text-text-muted px-0.5">
                  {PHASES.map(p => (
                    <span key={p} className={`${p === phase ? 'text-text-primary font-medium' : ''}`}>
                      {phaseConfig[p].label}
                    </span>
                  ))}
                </div>

                {/* Week progress (regular season only) */}
                {isRegular && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-muted">Week Progress</span>
                      <span className="font-mono text-text-primary">
                        {state.currentWeek} / {state.totalWeeks}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-surface-overlay overflow-hidden">
                      <div
                        className="h-full rounded-full bg-neon transition-all"
                        style={{ width: `${(state.currentWeek / state.totalWeeks) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => confirmWeekAdvance(league.id)}
                        disabled={atWeekLimit}
                        className={atWeekLimit ? 'opacity-50' : ''}
                      >
                        <SkipForward size={12} />
                        Advance Week
                      </Button>
                    </div>
                  </div>
                )}

                {/* Phase advance */}
                <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
                  <div className="text-xs text-text-muted">
                    {config.description}
                  </div>
                  {nextPhase ? (
                    <Button
                      size="sm"
                      onClick={() => confirmAdvance(league)}
                      className="bg-neon text-surface-base hover:bg-neon/90"
                    >
                      <Play size={12} />
                      Advance to {phaseConfig[nextPhase].label}
                    </Button>
                  ) : (
                    <span className="text-xs text-text-muted">Season complete</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Draft Order */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider">
          Draft Order
        </h3>
        {leagueList.map(league => (
          <DraftOrderEditor
            key={league.id}
            leagueId={league.id}
            leagueName={league.name}
            leagueColor={league.color}
          />
        ))}
      </div>

      {/* Advance Phase Confirmation */}
      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-draw" />
              Advance Phase
            </DialogTitle>
            <DialogDescription>
              {advanceTarget && (
                <>
                  Advance <strong>{leagueList.find(l => l.id === advanceTarget.leagueId)?.name}</strong> from{' '}
                  <strong>{phaseConfig[advanceTarget.from].label}</strong> to{' '}
                  <strong>{phaseConfig[advanceTarget.to].label}</strong>?
                  This action cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceOpen(false)}>Cancel</Button>
            <Button onClick={executeAdvance} className="bg-neon text-surface-base hover:bg-neon/90">
              Confirm Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Week Advance Confirmation */}
      <Dialog open={weekOpen} onOpenChange={setWeekOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Advance Week</DialogTitle>
            <DialogDescription>
              {weekTarget && (
                <>
                  Advance <strong>{leagueList.find(l => l.id === weekTarget)?.name}</strong> to{' '}
                  <strong>Week {leagueStates[weekTarget].currentWeek + 1}</strong>?
                  Ensure all match results for the current week are reported.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWeekOpen(false)}>Cancel</Button>
            <Button onClick={executeWeekAdvance} className="bg-neon text-surface-base hover:bg-neon/90">
              Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* League Edit Dialog */}
      <LeagueEditDialog
        open={leagueEditOpen}
        onOpenChange={setLeagueEditOpen}
        editingLeague={editingLeague}
        editName={editName}
        setEditName={setEditName}
        editColor={editColor}
        setEditColor={setEditColor}
        onSave={saveLeague}
      />

      {/* Delete League Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-loss" />
              Delete League
            </DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  Permanently delete <strong>{leagueList.find(l => l.id === deleteTarget)?.name}</strong>?
                  This will remove all associated season data. This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={executeDeleteLeague}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Season Wizard */}
      <NewSeasonWizard open={wizardOpen} onClose={() => setWizardOpen(false)} leagues={leagueList} />
    </div>
  );
}
