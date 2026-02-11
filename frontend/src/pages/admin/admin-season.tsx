import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { leagues as defaultLeagues } from '@/mocks/leagues';
import { toast } from 'sonner';
import {
  ChevronRight, Play, SkipForward, AlertTriangle,
  Sparkles, Calendar, Trophy, Swords, Flag,
  Plus, Pencil, Trash2, X, Check,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

const PHASES = ['draft', 'regular', 'playoffs', 'offseason'] as const;
type Phase = typeof PHASES[number];

const phaseConfig: Record<Phase, { label: string; color: string; icon: typeof Play; description: string }> = {
  draft: { label: 'Draft', color: 'text-draw bg-draw/10 border-draw/30', icon: Trophy, description: 'Teams draft Pokemon from the tier list' },
  regular: { label: 'Regular Season', color: 'text-neon bg-neon/10 border-neon/30', icon: Swords, description: 'Weekly matches and standings' },
  playoffs: { label: 'Playoffs', color: 'text-pink bg-pink/10 border-pink/30', icon: Flag, description: 'Top teams compete in elimination bracket' },
  offseason: { label: 'Offseason', color: 'text-text-muted bg-surface-overlay border-border', icon: Calendar, description: 'Between seasons — prep for next' },
};

function getNextPhase(current: Phase): Phase | null {
  const idx = PHASES.indexOf(current);
  return idx < PHASES.length - 1 ? PHASES[idx + 1] : null;
}

const PRESET_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c',
  '#0891b2', '#ca8a04', '#be185d', '#4f46e5', '#059669',
];

interface EditableLeague {
  id: string;
  name: string;
  color: string;
}

export function AdminSeason() {
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
      <Dialog open={leagueEditOpen} onOpenChange={setLeagueEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLeague ? 'Edit League' : 'New League'}</DialogTitle>
            <DialogDescription>
              {editingLeague ? 'Update the league name and color.' : 'Create a new league. You can add it to an active season later.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">League Name</label>
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="e.g. Diamond League"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && saveLeague()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-text-muted">Color</label>
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setEditColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        editColor === c ? 'border-white scale-110' : 'border-transparent hover:border-white/30'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5 ml-2">
                  <Input
                    value={editColor}
                    onChange={e => setEditColor(e.target.value)}
                    className="w-24 text-xs font-mono h-7"
                    placeholder="#hex"
                  />
                  <div
                    className="w-7 h-7 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: editColor }}
                  />
                </div>
              </div>
            </div>
            {/* Preview */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Preview</label>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-overlay">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: editColor }} />
                <span className="text-sm font-medium text-text-primary">{editName || 'League Name'}</span>
                <Badge variant="outline" className="text-[10px] ml-auto" style={{
                  borderColor: `${editColor}40`, color: editColor, backgroundColor: `${editColor}10`,
                }}>
                  {(editName || 'League').replace(' League', '')}
                </Badge>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeagueEditOpen(false)}>Cancel</Button>
            <Button
              onClick={saveLeague}
              disabled={!editName.trim()}
              className="bg-neon text-surface-base hover:bg-neon/90"
            >
              {editingLeague ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

/** ─── New Season Setup Wizard ─── */

type WizardStep = 'source' | 'leagues' | 'settings' | 'confirm';

interface WizardLeague {
  id: string;
  name: string;
  color: string;
  included: boolean;
}

interface NewSeasonConfig {
  copyPrevious: boolean;
  seasonNumber: number;
  totalWeeks: number;
  leagues: WizardLeague[];
  newLeagues: WizardLeague[];
  pointCap: number;
  teraCaptainSlots: number;
  maxTeams: number;
  rosterSize: number;
}

function NewSeasonWizard({ open, onClose, leagues }: { open: boolean; onClose: () => void; leagues: EditableLeague[] }) {
  const [step, setStep] = useState<WizardStep>('source');
  const [config, setConfig] = useState<NewSeasonConfig>(() => makeInitialConfig(leagues));

  // Inline add league
  const [addingLeague, setAddingLeague] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#9333ea');

  function makeInitialConfig(ls: EditableLeague[]): NewSeasonConfig {
    return {
      copyPrevious: true,
      seasonNumber: 11,
      totalWeeks: 11,
      leagues: ls.map(l => ({ ...l, included: true })),
      newLeagues: [],
      pointCap: 110,
      teraCaptainSlots: 2,
      maxTeams: 12,
      rosterSize: 11,
    };
  }

  function handleClose() {
    setStep('source');
    setConfig(makeInitialConfig(leagues));
    setAddingLeague(false);
    onClose();
  }

  function handleCreate() {
    const included = [
      ...config.leagues.filter(l => l.included),
      ...config.newLeagues.filter(l => l.included),
    ];
    toast.success(`Season ${config.seasonNumber} created for ${included.length} league(s)`);
    handleClose();
  }

  function toggleLeague(id: string, isNew: boolean) {
    if (isNew) {
      setConfig(prev => ({
        ...prev,
        newLeagues: prev.newLeagues.map(l => l.id === id ? { ...l, included: !l.included } : l),
      }));
    } else {
      setConfig(prev => ({
        ...prev,
        leagues: prev.leagues.map(l => l.id === id ? { ...l, included: !l.included } : l),
      }));
    }
  }

  function addNewLeague() {
    const name = newName.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ([...config.leagues, ...config.newLeagues].some(l => l.id === id)) {
      toast.error('A league with this name already exists');
      return;
    }
    setConfig(prev => ({
      ...prev,
      newLeagues: [...prev.newLeagues, { id, name, color: newColor, included: true }],
    }));
    setNewName('');
    setAddingLeague(false);
    toast.success(`Added "${name}"`);
  }

  function removeNewLeague(id: string) {
    setConfig(prev => ({
      ...prev,
      newLeagues: prev.newLeagues.filter(l => l.id !== id),
    }));
  }

  const allLeagues = [...config.leagues, ...config.newLeagues];
  const selectedCount = allLeagues.filter(l => l.included).length;

  const steps: WizardStep[] = ['source', 'leagues', 'settings', 'confirm'];
  const stepIdx = steps.indexOf(step);

  const QUICK_COLORS = ['#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#be185d', '#4f46e5', '#059669'];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-pink" />
            New Season Setup
          </DialogTitle>
          <DialogDescription>
            Step {stepIdx + 1} of {steps.length}
          </DialogDescription>
        </DialogHeader>

        {/* Step progress */}
        <div className="flex gap-1 mb-2">
          {steps.map((s, i) => (
            <div key={s} className={`flex-1 h-1 rounded-full ${
              i <= stepIdx ? 'bg-pink' : 'bg-surface-overlay'
            }`} />
          ))}
        </div>

        {/* Step 1: Source */}
        {step === 'source' && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">Start from previous season settings or configure from scratch?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setConfig(p => ({ ...p, copyPrevious: true }))}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  config.copyPrevious
                    ? 'border-pink bg-pink/10 text-text-primary'
                    : 'border-border hover:border-border-default text-text-secondary'
                }`}
              >
                <div className="font-medium text-sm mb-1">Copy Previous</div>
                <div className="text-xs text-text-muted">Use Season 10 settings as base</div>
              </button>
              <button
                onClick={() => setConfig(p => ({ ...p, copyPrevious: false }))}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  !config.copyPrevious
                    ? 'border-pink bg-pink/10 text-text-primary'
                    : 'border-border hover:border-border-default text-text-secondary'
                }`}
              >
                <div className="font-medium text-sm mb-1">Fresh Setup</div>
                <div className="text-xs text-text-muted">Configure everything from scratch</div>
              </button>
            </div>
            <div className="space-y-1 pt-2">
              <label className="text-xs text-text-muted">Season Number</label>
              <input
                type="number"
                value={config.seasonNumber}
                onChange={e => setConfig(p => ({ ...p, seasonNumber: Number(e.target.value) }))}
                className="w-24 bg-surface-overlay border border-border rounded px-2 py-1 text-sm text-text-primary"
              />
            </div>
          </div>
        )}

        {/* Step 2: Leagues — select, add new, edit */}
        {step === 'leagues' && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Select leagues for Season {config.seasonNumber}. You can also add new leagues.
            </p>

            {/* Existing leagues */}
            <div className="space-y-1.5">
              {config.leagues.map(l => (
                <button
                  key={l.id}
                  onClick={() => toggleLeague(l.id, false)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                    l.included
                      ? 'border-pink/50 bg-pink/5'
                      : 'border-border hover:border-border-default'
                  }`}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                  <span className="font-medium text-sm text-text-primary flex-1">{l.name}</span>
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                    l.included
                      ? 'bg-pink border-pink text-white'
                      : 'border-border'
                  }`}>
                    {l.included && <Check size={12} />}
                  </div>
                </button>
              ))}

              {/* Newly added leagues */}
              {config.newLeagues.map(l => (
                <div
                  key={l.id}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                    l.included
                      ? 'border-pink/50 bg-pink/5'
                      : 'border-border'
                  }`}
                >
                  <button
                    onClick={() => toggleLeague(l.id, true)}
                    className="flex items-center gap-3 flex-1 text-left"
                  >
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                    <span className="font-medium text-sm text-text-primary flex-1">{l.name}</span>
                    <Badge variant="outline" className="text-[9px] border-neon/30 text-neon bg-neon/10">NEW</Badge>
                  </button>
                  <button
                    onClick={() => removeNewLeague(l.id)}
                    className="p-1 rounded hover:bg-loss/10 text-text-muted hover:text-loss transition-colors"
                  >
                    <X size={12} />
                  </button>
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                    l.included
                      ? 'bg-pink border-pink text-white'
                      : 'border-border'
                  }`}>
                    {l.included && <Check size={12} />}
                  </div>
                </div>
              ))}
            </div>

            {/* Inline add new league */}
            {addingLeague ? (
              <div className="rounded-lg border border-neon/30 bg-neon/5 p-3 space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-text-muted">League Name</label>
                  <Input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Diamond League"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && addNewLeague()}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-text-muted shrink-0">Color</label>
                  <div className="flex gap-1">
                    {QUICK_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setNewColor(c)}
                        className={`w-5 h-5 rounded-full border transition-all ${
                          newColor === c ? 'border-white scale-110' : 'border-transparent hover:border-white/30'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <Input
                    value={newColor}
                    onChange={e => setNewColor(e.target.value)}
                    className="w-20 text-xs font-mono h-6 ml-1"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="xs" variant="ghost" onClick={() => { setAddingLeague(false); setNewName(''); }}>
                    Cancel
                  </Button>
                  <Button size="xs" onClick={addNewLeague} disabled={!newName.trim()} className="bg-neon text-surface-base hover:bg-neon/90">
                    <Plus size={12} />
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingLeague(true)}
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg border border-dashed border-border hover:border-neon/50 text-text-muted hover:text-neon transition-colors text-sm"
              >
                <Plus size={14} />
                Add New League
              </button>
            )}
          </div>
        )}

        {/* Step 3: Settings */}
        {step === 'settings' && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              {config.copyPrevious ? 'Inherited from Season 10 — adjust as needed.' : 'Configure season settings.'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                ['totalWeeks', 'Total Weeks', 1, 20],
                ['pointCap', 'Point Cap', 50, 200],
                ['teraCaptainSlots', 'Tera Captains', 0, 6],
                ['maxTeams', 'Max Teams', 2, 20],
                ['rosterSize', 'Roster Size', 6, 20],
              ] as const).map(([key, label, min, max]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-text-muted">{label}</label>
                  <input
                    type="number"
                    value={config[key]}
                    onChange={e => setConfig(p => ({ ...p, [key]: Number(e.target.value) }))}
                    min={min}
                    max={max}
                    className="w-full bg-surface-overlay border border-border rounded px-2 py-1.5 text-sm text-text-primary"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 'confirm' && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">Review and confirm your new season setup.</p>
            <div className="bg-surface-overlay rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Season</span>
                <span className="text-text-primary font-mono">{config.seasonNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Source</span>
                <span className="text-text-primary">{config.copyPrevious ? 'Copied from S10' : 'Fresh setup'}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-text-muted">Leagues</span>
                <div className="flex gap-1 flex-wrap justify-end">
                  {allLeagues.filter(l => l.included).map(l => (
                    <Badge key={l.id} variant="outline" className="text-[10px]" style={{
                      borderColor: `${l.color}40`, color: l.color, backgroundColor: `${l.color}10`,
                    }}>
                      {l.name.replace(' League', '')}
                      {config.newLeagues.some(nl => nl.id === l.id) && ' (new)'}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="border-t border-border-subtle pt-2 mt-2 space-y-1">
                <div className="flex justify-between">
                  <span className="text-text-muted">Weeks</span>
                  <span className="font-mono">{config.totalWeeks}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Point Cap</span>
                  <span className="font-mono">{config.pointCap}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Tera Captains</span>
                  <span className="font-mono">{config.teraCaptainSlots}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Max Teams</span>
                  <span className="font-mono">{config.maxTeams}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Roster Size</span>
                  <span className="font-mono">{config.rosterSize}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {stepIdx > 0 ? (
            <Button variant="outline" onClick={() => setStep(steps[stepIdx - 1])}>Back</Button>
          ) : (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {stepIdx < steps.length - 1 ? (
            <Button
              onClick={() => setStep(steps[stepIdx + 1])}
              disabled={step === 'leagues' && selectedCount === 0}
              className="bg-pink text-surface-base hover:bg-pink/90"
            >
              Next
            </Button>
          ) : (
            <Button onClick={handleCreate} className="bg-pink text-surface-base hover:bg-pink/90">
              <Sparkles size={14} />
              Create Season {config.seasonNumber}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
