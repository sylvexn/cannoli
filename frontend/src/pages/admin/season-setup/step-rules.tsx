import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Pencil, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api, type ApiCostFormat, type ApiRuleset, type ApiSeasonSetupDefaults } from '@/lib/api';
import { budgetPreview, formErrors, markupRows, setMarkup, type RulesetForm } from '../rulesets/form';
import {
  baseFor, changedKeys, includedLeagues, prevFor, summarySegments,
  type Draft, type RulesChoice, type SetupLeague,
} from './logic';

const toValue = (c: RulesChoice) => (typeof c === 'number' ? `t:${c}` : c);
const fromValue = (v: string): RulesChoice => (v.startsWith('t:') ? Number(v.slice(2)) : (v as 'copy' | 'blank'));

function Field({ label, hint, children }: { label: string; hint?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase text-text-muted">
        {label}{hint && <span className="normal-case text-draw">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function RuleCard({ league, defaults, templates, formats, prevN, onChange }: {
  league: SetupLeague;
  defaults: ApiSeasonSetupDefaults;
  templates: ApiRuleset[];
  formats: ApiCostFormat[];
  prevN: number | undefined;
  onChange: (p: Partial<SetupLeague>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [table, setTable] = useState(false);
  const f = league.rules;
  const prev = prevFor(league, defaults);
  const prevLabel = `S${prevN}`;
  const nChanges = prev ? changedKeys(f, prev).length : 0;
  const errors = formErrors(f);
  const set = (p: Partial<RulesetForm>) => onChange({ rules: { ...f, ...p } });
  const hint = <K extends keyof RulesetForm>(k: K, fmt: (v: RulesetForm[K]) => string = String) =>
    prev && JSON.stringify(prev[k]) !== JSON.stringify(f[k]) ? `${prevLabel}: ${fmt(prev[k])}` : null;
  const budget = budgetPreview(f);
  const copyLabel = `Copy of ${prevLabel} ${league.name}`;

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
        <span className="text-sm font-medium min-w-0 truncate">{league.name}</span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={toValue(league.choice)}
            onValueChange={v => {
              const choice = fromValue(v ?? 'blank');
              onChange({ choice, rules: baseFor({ ...league, choice }, defaults, templates) });
            }}>
            <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {league.sourceLeagueId && <SelectItem value="copy">{copyLabel}</SelectItem>}
              {templates.map(t => <SelectItem key={t.id} value={`t:${t.id}`}>{t.name}</SelectItem>)}
              <SelectItem value="blank">Start blank</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditing(e => !e)}>
            {editing ? <X size={12} /> : <Pencil size={12} />}{editing ? 'Close' : 'Edit'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-muted">
        <span>
          {summarySegments(f, prev).map((s, i) => (
            <span key={i}>{i > 0 && ' · '}<span className={s.changed ? 'text-draw' : ''}>{s.text}</span></span>
          ))}
        </span>
        {nChanges > 0 && <Badge variant="outline" className="text-draw border-draw/40">{nChanges} change{nChanges > 1 ? 's' : ''} vs {prevLabel}</Badge>}
      </div>

      {editing && (
        <div className="space-y-3 border-t border-border-subtle pt-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Cost format" hint={hint('costFormat')}>
              <Select value={f.costFormat} onValueChange={v => set({ costFormat: v ?? f.costFormat })}>
                <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {formats.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                  {!formats.some(c => c.id === f.costFormat) && <SelectItem value={f.costFormat}>{f.costFormat}</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Point cap" hint={hint('pointCap')}>
              <NumberInput value={f.pointCap} min={1} onChange={n => set({ pointCap: n })} />
            </Field>
            <Field label="Roster size" hint={hint('rosterSize')}>
              <NumberInput value={f.rosterSize} min={1} onChange={n => set({ rosterSize: n })} />
            </Field>
            <Field label={f.megaLimited ? 'Mega cap' : 'Mega cap (unlimited)'} hint={hint('megaCap', () => (prev!.megaLimited ? String(prev!.megaCap) : 'unlimited'))}>
              <div className="flex items-center gap-2">
                <NumberInput value={f.megaCap} min={0} disabled={!f.megaLimited} onChange={n => set({ megaCap: n })} />
                <Switch size="sm" checked={!f.megaLimited} onCheckedChange={c => set({ megaLimited: !c })} />
              </div>
            </Field>
            <Field label="Captains" hint={hint('teraCaptainSlots')}>
              <NumberInput value={f.teraCaptainSlots} min={0} disabled={!f.teraEnabled} onChange={n => set({ teraCaptainSlots: n })} />
            </Field>
            <Field label="Types / captain" hint={hint('teraTypesPerCaptain')}>
              <div className="flex items-center gap-2">
                <NumberInput value={f.teraTypesPerCaptain} min={1} disabled={!f.teraEnabled} onChange={n => set({ teraTypesPerCaptain: n })} />
                <Switch size="sm" checked={f.teraEnabled} onCheckedChange={c => set({ teraEnabled: c })} />
                <span className="text-[10px] text-text-muted">tera</span>
              </div>
            </Field>
          </div>

          <div>
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => setTable(t => !t)}>
              {table ? <ChevronUp size={12} /> : <ChevronDown size={12} />}Edit markup table
              {prev && JSON.stringify(prev.teraMarkup) !== JSON.stringify(f.teraMarkup) && <span className="text-draw">changed</span>}
            </Button>
            {table && (
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-2">
                {markupRows(f).map(r => (
                  <div key={r.tier} className="flex items-center gap-1.5 rounded border border-border-subtle px-2 py-1">
                    <span className="font-mono text-[11px] text-text-muted w-6">T{r.tier}</span>
                    {r.eligible ? (
                      <>
                        <NumberInput value={f.teraMarkup[r.tier]} min={r.tier} className="w-20"
                          onChange={n => set({ teraMarkup: setMarkup(f.teraMarkup, r.tier, n) })} />
                        <button type="button" aria-label="Make ineligible" className="text-text-muted hover:text-loss"
                          onClick={() => set({ teraMarkup: setMarkup(f.teraMarkup, r.tier, null) })}><X size={12} /></button>
                      </>
                    ) : (
                      <button type="button" className="text-[11px] text-text-muted hover:text-text-primary"
                        onClick={() => set({ teraMarkup: setMarkup(f.teraMarkup, r.tier, r.tier) })}>ineligible, restore</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-text-muted">
            <span>Budget: {budget.avgPerMon.toFixed(1)} pts/mon, {budget.avgWithCaptains.toFixed(1)} with captains (+{budget.headroom} headroom)</span>
            {prev && (
              <Button size="sm" variant="ghost" className="gap-1 ml-auto" onClick={() => set({ ...prev, name: f.name, description: f.description })}>
                <RotateCcw size={12} />Reset to {prevLabel}
              </Button>
            )}
          </div>
          {errors.length > 0 && <ul className="text-[11px] text-loss list-disc pl-4">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
      {!editing && errors.length > 0 && <div className="text-[11px] text-loss">{errors[0]}</div>}
    </div>
  );
}

export function StepRules({ draft, patch, defaults, templates }: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  defaults: ApiSeasonSetupDefaults;
  templates: ApiRuleset[];
}) {
  const [formats, setFormats] = useState<ApiCostFormat[]>([]);
  useEffect(() => { api.getCostFormats().then(setFormats).catch(() => setFormats([])); }, []);
  const list = includedLeagues(draft);
  if (!list.length) return <div className="text-sm text-text-muted">No leagues included.</div>;
  return (
    <div className="space-y-3">
      {list.map(l => (
        <RuleCard key={l.key} league={l} defaults={defaults} templates={templates} formats={formats}
          prevN={defaults.source?.seasonNumber}
          onChange={p => patch({ leagues: draft.leagues.map(x => x.key === l.key ? { ...x, ...p } : x) })} />
      ))}
    </div>
  );
}
