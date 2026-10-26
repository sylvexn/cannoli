import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, GitFork, Lock, Save, RotateCcw } from 'lucide-react';
import { DEFAULT_MARKUP } from '@cannoli/rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, rulesetsApi, type ApiCostFormat, type ApiRuleset } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { budgetPreview, formErrors, markupRows, setMarkup, toForm, toInput, type RulesetForm } from './form';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1 min-w-0">
      <label className="text-[11px] font-mono uppercase tracking-wider text-text-muted">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-text-muted">{hint}</div>}
    </div>
  );
}

const NEW: Pick<RulesetForm, 'name'> = { name: '' };

export function RulesetEditor({ ruleset, onSaved, onCancel }: {
  /** null = creating a new template */
  ruleset: ApiRuleset | null;
  onSaved: (r: ApiRuleset) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RulesetForm>(() => toForm(ruleset ?? NEW));
  const [formats, setFormats] = useState<ApiCostFormat[]>([]);
  const [busy, setBusy] = useState(false);
  const [forkLeague, setForkLeague] = useState<string>(ruleset?.usedBy[0] ?? '');
  useEffect(() => { setForm(toForm(ruleset ?? NEW)); setForkLeague(ruleset?.usedBy[0] ?? ''); }, [ruleset]);
  useEffect(() => { api.getCostFormats().then(setFormats).catch(() => setFormats([])); }, []);

  const frozen = !!ruleset?.frozen;
  const lock = frozen; // rule fields; name/description/band stay editable
  const set = <K extends keyof RulesetForm>(k: K, v: RulesetForm[K]) => setForm(f => ({ ...f, [k]: v }));
  const errors = useMemo(() => formErrors(form), [form]);
  const rows = useMemo(() => markupRows(form), [form]);
  const preview = useMemo(() => budgetPreview(form), [form]);
  const markupWarn = rows.some(r => r.eligible && r.captain < r.tier);

  async function save() {
    setBusy(true);
    try {
      const body = toInput(form);
      const saved = ruleset
        ? await rulesetsApi.update(ruleset.id, body)
        : await rulesetsApi.create({ ...body });
      toast.success(ruleset ? 'Ruleset saved' : 'Template created');
      onSaved(saved);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally { setBusy(false); }
  }

  async function fork() {
    if (!ruleset || !forkLeague) return;
    setBusy(true);
    try {
      const saved = await rulesetsApi.fork(ruleset.id, { leagueId: forkLeague, changes: toInput(form) });
      toast.success(`Forked for ${forkLeague}`);
      onSaved(saved);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally { setBusy(false); }
  }

  const formatOptions = formats.some(f => f.id === form.costFormat)
    ? formats : [...formats, { id: form.costFormat, label: form.costFormat, leagueIds: [] }];

  return (
    <div className="space-y-3">
      {frozen && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-draw/30 bg-draw/5 p-2.5 text-xs text-text-secondary">
          <Lock size={14} className="text-draw shrink-0" />
          <span className="min-w-0 flex-1 basis-60">
            Frozen: used by {ruleset!.usedBy.join(', ')}. Rules are read-only; name, description and roster band stay editable.
            Fork to change rules for one league.
          </span>
          {ruleset!.usedBy.length > 0 && (
            <>
              <Select value={forkLeague} onValueChange={v => setForkLeague(v ?? '')}>
                <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ruleset!.usedBy.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={fork} disabled={busy || !forkLeague || errors.length > 0} className="gap-1.5">
                <GitFork size={13} />Fork for this league
              </Button>
            </>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="space-y-3 min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="Cost format" hint="Prices and bans come from the tier list of this format.">
              <Select value={form.costFormat} onValueChange={v => set('costFormat', v ?? form.costFormat)} disabled={lock}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {formatOptions.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
          </Field>

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            <Field label="Point cap">
              <NumberInput value={form.pointCap} min={1} max={500} disabled={lock} onChange={v => set('pointCap', v)} />
            </Field>
            <Field label="Roster size" hint="Draft rounds">
              <NumberInput value={form.rosterSize} min={1} max={30} disabled={lock} onChange={v => set('rosterSize', v)} />
            </Field>
            <Field label="Mega cap" hint={form.megaLimited ? (form.megaCap === 0 ? 'No megas' : 'Per team') : 'Unlimited'}>
              <div className="flex items-center gap-2">
                <NumberInput value={form.megaCap} min={0} max={10} disabled={lock || !form.megaLimited} onChange={v => set('megaCap', v)} />
                <label className="flex items-center gap-1 text-[10px] text-text-muted shrink-0">
                  <Switch size="sm" checked={!form.megaLimited} disabled={lock} onCheckedChange={c => set('megaLimited', !c)} />
                  Unl.
                </label>
              </div>
            </Field>
          </div>

          <div className="rounded-lg border border-border-subtle p-2.5 space-y-2">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <Switch size="sm" checked={form.customBand} onCheckedChange={c => set('customBand', c)} />
              Roster band (otherwise exactly roster size)
            </label>
            {form.customBand && (
              <div className="grid grid-cols-2 gap-3 max-w-xs">
                <Field label="Min"><NumberInput value={form.rosterMin} min={1} max={form.rosterSize} onChange={v => set('rosterMin', v)} /></Field>
                <Field label="Max"><NumberInput value={form.rosterMax} min={form.rosterSize} max={40} onChange={v => set('rosterMax', v)} /></Field>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border-subtle p-2.5 space-y-2">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <Switch size="sm" checked={form.teraEnabled} disabled={lock} onCheckedChange={c => set('teraEnabled', c)} />
              Tera captains (cost markup)
            </label>
            {form.teraEnabled && (
              <>
                <div className="grid grid-cols-2 gap-3 max-w-xs">
                  <Field label="Captains"><NumberInput value={form.teraCaptainSlots} min={0} max={form.rosterSize} disabled={lock} onChange={v => set('teraCaptainSlots', v)} /></Field>
                  <Field label="Types / captain"><NumberInput value={form.teraTypesPerCaptain} min={0} max={18} disabled={lock} onChange={v => set('teraTypesPerCaptain', v)} /></Field>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">Markup table</span>
                  <Button size="sm" variant="ghost" disabled={lock} className="h-6 gap-1 text-[11px]"
                    onClick={() => set('teraMarkup', { ...DEFAULT_MARKUP })}><RotateCcw size={11} />Standard</Button>
                </div>
                <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]">
                  {rows.map(r => (
                    <div key={r.tier} className="flex items-center gap-1.5 rounded border border-border-subtle px-1.5 py-1">
                      <span className="font-mono text-xs text-text-muted w-6 shrink-0">T{r.tier}</span>
                      <NumberInput
                        value={r.eligible ? r.captain : r.tier}
                        min={0} max={99}
                        disabled={lock || !r.eligible}
                        onChange={v => set('teraMarkup', setMarkup(form.teraMarkup, r.tier, v))}
                      />
                      <Switch size="sm" checked={r.eligible} disabled={lock}
                        aria-label={`Tier ${r.tier} captain eligible`}
                        onCheckedChange={c => set('teraMarkup', setMarkup(form.teraMarkup, r.tier, c ? r.tier : null))} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {(errors.length > 0 || markupWarn) && (
            <div className="space-y-1 text-xs text-draw">
              {errors.map(e => <div key={e} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{e}</div>)}
              {markupWarn && <div className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />A captain price is below its base cost.</div>}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={save} disabled={busy || errors.length > 0} className="bg-neon text-surface-base hover:bg-neon/90 gap-1.5">
              <Save size={13} />{ruleset ? 'Save' : 'Create template'}
            </Button>
            <Button variant="outline" onClick={onCancel}>Back</Button>
            <Link to="/admin/console#tiers" className="ml-auto self-center text-[11px] text-text-muted hover:text-text-primary">Edit prices</Link>
          </div>
        </div>

        <aside className="rounded-lg border border-border-default bg-surface-raised/30 p-3 space-y-3 text-xs min-w-0 h-fit">
          <div className="font-mono uppercase tracking-wider text-text-muted text-[11px]">Live preview</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-text-muted">Avg / mon</span><span className="font-mono text-right">{preview.avgPerMon.toFixed(1)}</span>
            <span className="text-text-muted">Captain headroom</span><span className="font-mono text-right">+{preview.headroom}</span>
            <span className="text-text-muted">Avg after captains</span><span className="font-mono text-right">{preview.avgWithCaptains.toFixed(1)}</span>
            <span className="text-text-muted">Roster</span><span className="font-mono text-right">{preview.band.min}–{preview.band.max}</span>
          </div>
          {form.teraEnabled && (
            <table className="w-full font-mono text-[11px]">
              <thead><tr className="text-text-muted text-left"><th>Tier</th><th>Base</th><th>Captain</th><th className="text-right">+</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.tier} className={r.eligible ? '' : 'text-text-muted line-through'}>
                    <td>T{r.tier}</td><td>{r.tier}</td><td>{r.eligible ? r.captain : '-'}</td>
                    <td className="text-right">{r.eligible ? (r.delta > 0 ? `+${r.delta}` : r.delta) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </aside>
      </div>
    </div>
  );
}
