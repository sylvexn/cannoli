import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { leagues } from '@/mocks/leagues';
import type { League } from '@/lib/types';
import { toast } from 'sonner';
import {
  ChevronRight, Play, SkipForward, AlertTriangle,
  Sparkles, Calendar, Trophy, Swords, Flag,
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

export function AdminSeason() {
  const [leagueStates, setLeagueStates] = useState(
    Object.fromEntries(leagues.map(l => [l.id, { ...l.season }]))
  );

  // Advance phase confirmation
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<{ leagueId: string; from: Phase; to: Phase } | null>(null);

  // Week advance confirmation
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekTarget, setWeekTarget] = useState<string | null>(null);

  // New season wizard
  const [wizardOpen, setWizardOpen] = useState(false);

  function confirmAdvance(league: League) {
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
    const name = leagues.find(l => l.id === leagueId)?.name;
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
    const name = leagues.find(l => l.id === weekTarget)?.name;
    const newWeek = leagueStates[weekTarget].currentWeek + 1;
    toast.success(`${name} advanced to Week ${newWeek}`);
    setWeekOpen(false);
    setWeekTarget(null);
  }

  return (
    <div className="space-y-4">
      {/* Header with new season button */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Current Season:</span>
          <span className="text-text-primary font-medium font-mono">10</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Leagues:</span>
          <span className="text-text-primary font-medium font-mono">{leagues.length}</span>
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setWizardOpen(true)} className="bg-pink text-surface-base hover:bg-pink/90">
            <Sparkles size={14} />
            New Season
          </Button>
        </div>
      </div>

      {/* League phase cards */}
      <div className="space-y-3">
        {leagues.map(league => {
          const state = leagueStates[league.id];
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
                  <Badge variant="outline" className={config.color}>
                    <Icon size={12} />
                    {config.label}
                  </Badge>
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
                  Advance <strong>{leagues.find(l => l.id === advanceTarget.leagueId)?.name}</strong> from{' '}
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
                  Advance <strong>{leagues.find(l => l.id === weekTarget)?.name}</strong> to{' '}
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

      {/* New Season Wizard */}
      <NewSeasonWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}

/** ─── New Season Setup Wizard ─── */

type WizardStep = 'source' | 'leagues' | 'settings' | 'confirm';

interface NewSeasonConfig {
  copyPrevious: boolean;
  seasonNumber: number;
  totalWeeks: number;
  selectedLeagues: Set<string>;
  pointCap: number;
  teraCaptainSlots: number;
  maxTeams: number;
  rosterSize: number;
}

function NewSeasonWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<WizardStep>('source');
  const [config, setConfig] = useState<NewSeasonConfig>({
    copyPrevious: true,
    seasonNumber: 11,
    totalWeeks: 11,
    selectedLeagues: new Set(leagues.map(l => l.id)),
    pointCap: 110,
    teraCaptainSlots: 2,
    maxTeams: 12,
    rosterSize: 11,
  });

  function handleClose() {
    setStep('source');
    onClose();
  }

  function handleCreate() {
    toast.success(`Season ${config.seasonNumber} created for ${config.selectedLeagues.size} league(s)`);
    handleClose();
  }

  function toggleLeague(id: string) {
    setConfig(prev => {
      const next = new Set(prev.selectedLeagues);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, selectedLeagues: next };
    });
  }

  const steps: WizardStep[] = ['source', 'leagues', 'settings', 'confirm'];
  const stepIdx = steps.indexOf(step);

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

        {/* Step 2: Select leagues */}
        {step === 'leagues' && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">Which leagues participate in Season {config.seasonNumber}?</p>
            <div className="space-y-2">
              {leagues.map(l => (
                <button
                  key={l.id}
                  onClick={() => toggleLeague(l.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    config.selectedLeagues.has(l.id)
                      ? 'border-pink/50 bg-pink/5'
                      : 'border-border hover:border-border-default'
                  }`}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                  <span className="font-medium text-sm text-text-primary flex-1">{l.name}</span>
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                    config.selectedLeagues.has(l.id)
                      ? 'bg-pink border-pink text-white'
                      : 'border-border'
                  }`}>
                    {config.selectedLeagues.has(l.id) && <span className="text-xs">✓</span>}
                  </div>
                </button>
              ))}
            </div>
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
              <div className="flex justify-between">
                <span className="text-text-muted">Leagues</span>
                <div className="flex gap-1">
                  {leagues.filter(l => config.selectedLeagues.has(l.id)).map(l => (
                    <Badge key={l.id} variant="outline" className="text-[10px]" style={{
                      borderColor: `${l.color}40`, color: l.color, backgroundColor: `${l.color}10`,
                    }}>
                      {l.name.replace(' League', '')}
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
              disabled={step === 'leagues' && config.selectedLeagues.size === 0}
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
