import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { toast } from 'sonner';
import { Sparkles, Plus, X, Check, Calendar, AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import type { EditableLeague } from './phase-config';
import { api } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';

type WizardStep = 'source' | 'leagues' | 'settings' | 'schedule' | 'confirm';

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
  weekDates: Record<string, string>;
}

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
    weekDates: {},
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ScheduleDatesStep({
  totalWeeks,
  weekDates,
  setWeekDates,
}: {
  totalWeeks: number;
  weekDates: Record<string, string>;
  setWeekDates: (next: Record<string, string>) => void;
}) {
  const week1 = weekDates['1'] ?? '';

  function setWeek(week: number, date: string) {
    const next = { ...weekDates };
    if (date) next[String(week)] = date;
    else delete next[String(week)];
    setWeekDates(next);
  }

  function fillRest() {
    if (!week1) return;
    const next: Record<string, string> = { '1': week1 };
    for (let w = 2; w <= totalWeeks; w++) {
      next[String(w)] = addDays(week1, (w - 1) * 7);
    }
    setWeekDates(next);
  }

  function clearAll() {
    setWeekDates({});
  }

  const filledCount = Object.keys(weekDates).filter(k => weekDates[k]).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Set the date each week ends. Auto-forfeit and auto-week-advance jobs use these to fire on time.
      </p>

      {/* Autofill row */}
      <div className="rounded-lg border border-border bg-surface-overlay p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-pink shrink-0" />
          <label className="text-xs text-text-muted shrink-0">Week 1 date</label>
          <input
            type="date"
            value={week1}
            onChange={e => setWeek(1, e.target.value)}
            className="flex h-8 rounded-md border border-border bg-surface-base px-2 py-1 text-xs text-text-primary outline-none transition-colors focus:border-pink/60 [color-scheme:dark]"
          />
          <Button
            size="xs"
            variant="outline"
            onClick={fillRest}
            disabled={!week1}
            className="ml-auto"
          >
            Fill rest weekly
          </Button>
        </div>
        <p className="text-[10px] text-text-muted">
          Click "Fill rest weekly" to auto-populate weeks 2–{totalWeeks} as +7 day increments. You can edit any week after.
        </p>
      </div>

      {/* Per-week list */}
      <div className="max-h-64 overflow-y-auto pr-1 space-y-1">
        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
          const value = weekDates[String(week)] ?? '';
          return (
            <div key={week} className="flex items-center gap-3 px-2 py-1.5 rounded border border-border-subtle">
              <span className="text-xs font-mono text-text-muted w-12 shrink-0">W{week}</span>
              <input
                type="date"
                value={value}
                onChange={e => setWeek(week, e.target.value)}
                className="flex h-7 flex-1 rounded-md border border-border bg-surface-base px-2 py-1 text-xs text-text-primary outline-none transition-colors focus:border-pink/60 [color-scheme:dark]"
              />
              <span className="text-[10px] text-text-muted w-16 text-right">
                {value ? formatShortDate(value) : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span>{filledCount} of {totalWeeks} weeks set</span>
        {filledCount > 0 && (
          <button onClick={clearAll} className="hover:text-loss transition-colors">Clear all</button>
        )}
      </div>
    </div>
  );
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

  function handleClose() {
    setStep('source');
    setConfig(makeInitialConfig(leagues));
    setAddingLeague(false);
    onClose();
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
    setCreating(true);
    try {
      const filledWeekDates = Object.fromEntries(
        Object.entries(config.weekDates).filter(([, v]) => !!v)
      );
      await api.createSeason({
        seasonNumber: config.seasonNumber,
        totalWeeks: config.totalWeeks,
        pointCap: config.pointCap,
        teraCaptainSlots: config.teraCaptainSlots,
        weekDates: Object.keys(filledWeekDates).length > 0 ? filledWeekDates : null,
        leagues: included.map(l => ({
          id: l.id,
          name: l.name,
          color: l.color,
        })),
      });
      toast.success(`Season ${config.seasonNumber} created for ${included.length} league(s)`);
      refreshLeagues();
      handleClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create season');
    } finally {
      setCreating(false);
    }
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

  const steps: WizardStep[] = ['source', 'leagues', 'settings', 'schedule', 'confirm'];
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
              ] as const).map(([key, label, min, max]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-text-muted">{label}</label>
                  <NumberInput
                    value={config[key]}
                    onChange={v => setConfig(p => ({ ...p, [key]: v }))}
                    min={min}
                    max={max}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Schedule dates */}
        {step === 'schedule' && (
          <ScheduleDatesStep
            totalWeeks={config.totalWeeks}
            weekDates={config.weekDates}
            setWeekDates={next => setConfig(p => ({ ...p, weekDates: next }))}
          />
        )}

        {/* Step 5: Confirm */}
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
              {(() => {
                const filled = Object.entries(config.weekDates).filter(([, v]) => !!v);
                if (filled.length === 0) return null;
                const sorted = filled.sort((a, b) => Number(a[0]) - Number(b[0]));
                const first = sorted[0];
                const last = sorted[sorted.length - 1];
                return (
                  <div className="border-t border-border-subtle pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Schedule</span>
                      <span className="font-mono text-xs">
                        W{first[0]} {formatShortDate(first[1])}
                        {sorted.length > 1 ? ` – W${last[0]} ${formatShortDate(last[1])}` : ''}
                        <span className="text-text-muted ml-1">({sorted.length}/{config.totalWeeks})</span>
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
            {Object.values(config.weekDates).filter(Boolean).length === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-draw/30 bg-draw/5 p-3 text-xs text-text-secondary">
                <AlertTriangle size={14} className="text-draw shrink-0 mt-0.5" />
                <span>
                  No schedule dates set. Auto-forfeit and auto-week-advance jobs won't fire until you set
                  weekly dates in league settings later.
                </span>
              </div>
            )}
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
            <Button onClick={handleCreate} disabled={creating} className="bg-pink text-surface-base hover:bg-pink/90">
              <Sparkles size={14} />
              {creating ? 'Creating…' : `Create Season ${config.seasonNumber}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
