import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rulesetsApi, type ApiRuleset } from '@/lib/api';
import { summarize } from './form';

/** Non-archived templates (the library the wizard / league assignment picks from). */
export function useRulesetTemplates(enabled = true) {
  const [list, setList] = useState<ApiRuleset[]>([]);
  useEffect(() => {
    if (!enabled) return;
    rulesetsApi.list({ kind: 'template' }).then(setList).catch(() => setList([]));
  }, [enabled]);
  return list;
}

export function RulesetSelect({ value, options, onChange, disabled, className }: {
  value: number | null;
  options: ApiRuleset[];
  onChange: (id: number | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value == null ? '' : String(value)} disabled={disabled}
      onValueChange={v => onChange(v ? Number(v) : null)}>
      <SelectTrigger className={className ?? 'w-full h-8 text-xs'}><SelectValue placeholder="Choose ruleset" /></SelectTrigger>
      <SelectContent>
        {options.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Season-level ruleset choice + one prefilled picker per league. */
export function WizardRulesets({ templates, seasonRulesetId, byLeague, leagues, onSeason, onLeague }: {
  templates: ApiRuleset[];
  seasonRulesetId: number | null;
  byLeague: Record<string, number | null>;
  leagues: { id: string; name: string; color: string }[];
  onSeason: (id: number | null) => void;
  onLeague: (leagueId: string, id: number | null) => void;
}) {
  const byId = (id: number | null) => templates.find(t => t.id === id);
  const season = byId(seasonRulesetId);
  return (
    <div className="space-y-2.5 rounded-lg border border-border-subtle p-3">
      <div className="space-y-1">
        <label className="text-xs text-text-muted">Season ruleset (prefills every league)</label>
        <RulesetSelect value={seasonRulesetId} options={templates} onChange={onSeason} />
        {season && <div className="text-[10px] font-mono text-text-muted">{summarize(season)}</div>}
        {templates.length === 0 && (
          <div className="text-[11px] text-draw">No templates yet. <Link to="/admin/rulesets" className="underline">Create one</Link>.</div>
        )}
      </div>
      <div className="space-y-1.5">
        {leagues.map(l => {
          const picked = byId(byLeague[l.id] ?? null);
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs w-32 shrink-0 min-w-0">
                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                <span className="truncate min-w-0">{l.name.replace(' League', '')}</span>
              </span>
              <div className="flex-1 min-w-40">
                <RulesetSelect value={byLeague[l.id] ?? null} options={templates} onChange={id => onLeague(l.id, id)} />
              </div>
              {picked && <span className="basis-full text-[10px] font-mono text-text-muted pl-1 truncate">{summarize(picked)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
