import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { toast } from 'sonner';
import { Sparkles, Plus, X, Check, Layers } from 'lucide-react';
import type { ApiDraftTemplate } from '@/lib/api';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import type { EditableLeague } from './phase-config';
import { api } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { ProvisionTeamsStep, type LeagueTeamsState, type TeamRow } from './provision-teams-step';
import { OverlapConfirmDialog } from './overlap-confirm-dialog';
import { ScheduleDatesStep } from './schedule-dates-step';
import { ConfirmStep } from './confirm-step';

type WizardStep = 'source' | 'leagues' | 'settings' | 'teams' | 'schedule' | 'confirm';

interface WizardLeague {
  id: string;
  name: string;
  color: string;
  included: boolean;
}

interface NewSeasonConfig {
  copyPrevious: boolean;
  /** When set, the wizard was seeded from this template — informational only,
   *  the user can still tweak any field before submitting. */
  fromTemplateId: number | null;
  seasonNumber: number;
  totalWeeks: number;
  leagues: WizardLeague[];
  newLeagues: WizardLeague[];
  pointCap: number;
  teraCaptainSlots: number;
  maxTeams: number;
  rosterSize: number;
  tradeDeadlineWeek: number;
  forfeitPolicy: 'double_forfeit' | 'admin_review';
  /** Battle format applied to every league created by this wizard. Per-league
   *  override still happens later via /admin/leagues. */
  format: string;
  weekDates: Record<string, string>;
  /** Per-league draft date (ISO datetime). Keyed by league id. */
  draftDates: Record<string, string>;
  teamsByLeague: LeagueTeamsState[];
}

function makeInitialConfig(ls: EditableLeague[]): NewSeasonConfig {
  return {
    copyPrevious: true,
    fromTemplateId: null,
    seasonNumber: 11,
    totalWeeks: 11,
    leagues: ls.map(l => ({ ...l, included: true })),
    newLeagues: [],
    pointCap: 110,
    teraCaptainSlots: 2,
    maxTeams: 12,
    rosterSize: 11,
    tradeDeadlineWeek: 7,
    forfeitPolicy: 'double_forfeit',
    format: 'gen9natdex',
    weekDates: {},
    draftDates: {},
    teamsByLeague: [],
  };
}

function emptyTeamRow(): TeamRow {
  return { teamName: '', teamAbbrev: '', teamColor: '#888888', managerUsername: '', coachName: '' };
}

/**
 * Sync teamsByLeague with currently-included leagues + maxTeams.
 * - Adds new entries for newly included leagues.
 * - Drops entries for de-selected leagues.
 * - Adjusts row counts when maxTeams changes (preserves existing rows).
 */
function syncTeamsByLeague(
  prev: LeagueTeamsState[],
  included: { id: string; name: string; color: string }[],
  maxTeams: number,
): LeagueTeamsState[] {
  const byId = new Map(prev.map(p => [p.leagueId, p]));
  return included.map(l => {
    const existing = byId.get(l.id);
    const targetCount = existing?.count ?? maxTeams;
    let rows = existing?.rows ?? [];
    if (rows.length < targetCount) {
      rows = [...rows, ...Array.from({ length: targetCount - rows.length }, emptyTeamRow)];
    } else if (rows.length > targetCount) {
      rows = rows.slice(0, targetCount);
    }
    return {
      leagueId: l.id,
      leagueName: l.name,
      leagueColor: l.color,
      count: targetCount,
      rows,
      cloneSourceSeasonId: existing?.cloneSourceSeasonId ?? null,
      cloneSourceLeagueId: existing?.cloneSourceLeagueId ?? null,
    };
  });
}

export function NewSeasonWizard({ open, onClose, leagues }: { open: boolean; onClose: () => void; leagues: EditableLeague[] }) {
  const { refreshLeagues } = useAppData();
  const [step, setStep] = useState<WizardStep>('source');
  const [config, setConfig] = useState<NewSeasonConfig>(() => makeInitialConfig(leagues));
  const [creating, setCreating] = useState(false);

  // Inline add league
  const [addingLeague, setAddingLeague] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#9333ea');

  // Templates — loaded lazily when the wizard opens. Empty array is a valid
  // state (no templates configured yet); we just don't render the picker.
  const [templates, setTemplates] = useState<ApiDraftTemplate[]>([]);
  useEffect(() => {
    if (!open) return;
    api.listDraftTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [open]);

  function applyTemplate(t: ApiDraftTemplate) {
    setConfig(prev => ({
      ...prev,
      copyPrevious: false,
      fromTemplateId: t.id,
      pointCap: t.pointCap,
      teraCaptainSlots: t.captainCount,
      rosterSize: t.rosterSize,
      format: t.format,
    }));
    toast.success(`Seeded from "${t.name}" — tweak any field before creating.`);
  }

  // Overlap-season confirmation
  const [overlapPrompt, setOverlapPrompt] = useState<{ priorSeasonNumber: number; priorPhase: string } | null>(null);

  function handleClose() {
    setStep('source');
    setConfig(makeInitialConfig(leagues));
    setAddingLeague(false);
    setOverlapPrompt(null);
    onClose();
  }

  function buildPayload(includedList: WizardLeague[], overlapOverride: boolean) {
    const filledWeekDates = Object.fromEntries(
      Object.entries(config.weekDates).filter(([, v]) => !!v)
    );
    return {
      seasonNumber: config.seasonNumber,
      totalWeeks: config.totalWeeks,
      pointCap: config.pointCap,
      teraCaptainSlots: config.teraCaptainSlots,
      rosterSize: config.rosterSize,
      tradeDeadlineWeek: config.tradeDeadlineWeek,
      forfeitPolicy: config.forfeitPolicy,
      format: config.format,
      weekDates: Object.keys(filledWeekDates).length > 0 ? filledWeekDates : null,
      overlapOverride,
      leagues: includedList.map(l => {
        const teamState = config.teamsByLeague.find(t => t.leagueId === l.id);
        const teams = (teamState?.rows ?? [])
          .filter(r => r.teamName.trim() && r.teamAbbrev.trim())
          .map(r => ({
            teamName: r.teamName.trim(),
            teamAbbrev: r.teamAbbrev.trim(),
            teamColor: r.teamColor,
            managerUsername: r.managerUsername.trim() || null,
            coachName: r.coachName.trim() || undefined,
          }));
        const draftDate = config.draftDates[l.id]?.trim() || null;
        return {
          id: l.id,
          name: l.name,
          color: l.color,
          draftDate: draftDate ? new Date(draftDate).toISOString() : null,
          teams,
        };
      }),
    };
  }

  async function postCreate(includedList: WizardLeague[], overlapOverride: boolean) {
    setCreating(true);
    try {
      const result = await api.createSeason(buildPayload(includedList, overlapOverride));
      const teamMsg = result.teamsCreated > 0 ? `, ${result.teamsCreated} teams` : '';
      toast.success(`Season ${config.seasonNumber} created for ${includedList.length} league(s)${teamMsg}`);
      if (result.unresolvedManagers && result.unresolvedManagers.length > 0) {
        toast.warning(`Unresolved managers (assign in Teams tab): ${result.unresolvedManagers.join(', ')}`);
      }
      refreshLeagues();
      handleClose();
    } catch (err: any) {
      // Detect overlap error and pop confirmation. Backend returns either:
      //   message text "prior_season_active" (current postJson behavior — only `error` is surfaced)
      const msg = err?.message || '';
      if (msg === 'prior_season_active') {
        // Look up active season number client-side since postJson swallowed extra fields.
        try {
          const seasons = await api.getSeasons();
          const active = seasons.find(s => s.phase !== 'offseason');
          if (active) {
            setOverlapPrompt({ priorSeasonNumber: active.seasonNumber, priorPhase: active.phase });
          } else {
            toast.error('Backend reported overlap but no active season found');
          }
        } catch {
          toast.error('Overlap detected — could not load prior season info');
        }
      } else {
        toast.error(msg || 'Failed to create season');
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleCreate() {
    const included = [
      ...config.leagues.filter(l => l.included),
      ...config.newLeagues.filter(l => l.included),
    ];
    if (included.length === 0) {
      toast.error('Select at least one league');
      return;
    }
    await postCreate(included, false);
  }

  async function handleOverlapConfirm() {
    const included = [
      ...config.leagues.filter(l => l.included),
      ...config.newLeagues.filter(l => l.included),
    ];
    setOverlapPrompt(null);
    await postCreate(included, true);
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

  const steps: WizardStep[] = ['source', 'leagues', 'settings', 'teams', 'schedule', 'confirm'];
  const stepIdx = steps.indexOf(step);

  function goToStep(target: WizardStep) {
    // When entering Teams step, sync teamsByLeague with currently-included leagues.
    if (target === 'teams') {
      const included = allLeagues.filter(l => l.included).map(l => ({ id: l.id, name: l.name, color: l.color }));
      setConfig(p => ({ ...p, teamsByLeague: syncTeamsByLeague(p.teamsByLeague, included, p.maxTeams) }));
    }
    setStep(target);
  }

  const QUICK_COLORS = ['#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#be185d', '#4f46e5', '#059669'];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className={step === 'teams' ? 'max-w-3xl' : 'max-w-lg'}>
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
                onClick={() => setConfig(p => ({ ...p, copyPrevious: true, fromTemplateId: null }))}
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
                onClick={() => setConfig(p => ({ ...p, copyPrevious: false, fromTemplateId: null }))}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  !config.copyPrevious && config.fromTemplateId == null
                    ? 'border-pink bg-pink/10 text-text-primary'
                    : 'border-border hover:border-border-default text-text-secondary'
                }`}
              >
                <div className="font-medium text-sm mb-1">Fresh Setup</div>
                <div className="text-xs text-text-muted">Configure everything from scratch</div>
              </button>
            </div>

            {/* Template picker — when at least one is configured. Selecting a
             *  template seeds format + captain count + cap/roster + name into
             *  the wizard state so the admin doesn't retype them. Tweakable
             *  after seeding. */}
            {templates.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Layers size={11} />
                  <span>Or start from a saved template:</span>
                </div>
                <div className="space-y-1.5">
                  {templates.map(t => {
                    const active = config.fromTemplateId === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                          active
                            ? 'border-neon bg-neon/10 text-text-primary'
                            : 'border-border hover:border-border-default text-text-secondary'
                        }`}
                      >
                        <Layers size={14} className={active ? 'text-neon' : 'text-text-muted'} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{t.name}</div>
                          <div className="text-[10px] text-text-muted truncate">
                            {t.format} · {t.captainCount} captains · {t.pointCap} pts · {t.rosterSize} roster
                          </div>
                        </div>
                        {active && <Check size={14} className="text-neon shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1 pt-2">
              <label className="text-xs text-text-muted">Season Number</label>
              <NumberInput
                value={config.seasonNumber}
                onChange={v => setConfig(p => ({ ...p, seasonNumber: v }))}
                min={1}
                className="w-24"
              />
            </div>
          </div>
        )}

        {/* Step 2: Leagues -- select, add new, edit */}
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
                ['tradeDeadlineWeek', 'Trade Deadline (week)', 1, 20],
              ] as const).map(([key, label, min, max]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-text-muted">{label}</label>
                  <NumberInput
                    value={config[key] as number}
                    onChange={v => setConfig(p => ({ ...p, [key]: v }))}
                    min={min}
                    max={max}
                  />
                </div>
              ))}
            </div>

            {/* Forfeit policy */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Forfeit Policy</label>
              <div className="flex gap-2">
                {([
                  ['double_forfeit', 'Double Forfeit', 'Both teams take an L when a deadline passes'],
                  ['admin_review', 'Admin Review', 'Match enters disputed state for manual ruling'],
                ] as const).map(([value, label, desc]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setConfig(p => ({ ...p, forfeitPolicy: value }))}
                    className={`flex-1 p-2.5 rounded-lg border text-left transition-colors ${
                      config.forfeitPolicy === value
                        ? 'border-pink bg-pink/10 text-text-primary'
                        : 'border-border hover:border-border-default text-text-secondary'
                    }`}
                  >
                    <div className="text-xs font-medium">{label}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">{desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Provision Teams */}
        {step === 'teams' && (
          <ProvisionTeamsStep
            state={config.teamsByLeague}
            setState={next => setConfig(p => ({ ...p, teamsByLeague: next }))}
            defaultMaxTeams={config.maxTeams}
          />
        )}

        {/* Step 5: Schedule dates */}
        {step === 'schedule' && (
          <ScheduleDatesStep
            totalWeeks={config.totalWeeks}
            weekDates={config.weekDates}
            setWeekDates={next => setConfig(p => ({ ...p, weekDates: next }))}
            leagues={allLeagues.filter(l => l.included).map(l => ({ id: l.id, name: l.name, color: l.color }))}
            draftDates={config.draftDates}
            setDraftDates={next => setConfig(p => ({ ...p, draftDates: next }))}
          />
        )}

        {/* Step 6: Confirm */}
        {step === 'confirm' && (
          <ConfirmStep
            seasonNumber={config.seasonNumber}
            copyPrevious={config.copyPrevious}
            totalWeeks={config.totalWeeks}
            pointCap={config.pointCap}
            teraCaptainSlots={config.teraCaptainSlots}
            maxTeams={config.maxTeams}
            rosterSize={config.rosterSize}
            weekDates={config.weekDates}
            teamsByLeague={config.teamsByLeague}
            includedLeagues={allLeagues.filter(l => l.included).map(l => ({
              id: l.id,
              name: l.name,
              color: l.color,
              isNew: config.newLeagues.some(nl => nl.id === l.id),
            }))}
          />
        )}

        <DialogFooter>
          {stepIdx > 0 ? (
            <Button variant="outline" onClick={() => goToStep(steps[stepIdx - 1]!)}>Back</Button>
          ) : (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {stepIdx < steps.length - 1 ? (
            <Button
              onClick={() => goToStep(steps[stepIdx + 1]!)}
              disabled={step === 'leagues' && selectedCount === 0}
              className="bg-pink text-surface-base hover:bg-pink/90"
            >
              Next
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={creating} className="bg-pink text-surface-base hover:bg-pink/90">
              <Sparkles size={14} />
              {creating ? 'Creating…' : `Create Season ${config.seasonNumber}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {overlapPrompt && (
        <OverlapConfirmDialog
          open={!!overlapPrompt}
          onClose={() => setOverlapPrompt(null)}
          priorSeasonNumber={overlapPrompt.priorSeasonNumber}
          priorPhase={overlapPrompt.priorPhase}
          newSeasonNumber={config.seasonNumber}
          onConfirm={handleOverlapConfirm}
        />
      )}
    </Dialog>
  );
}
