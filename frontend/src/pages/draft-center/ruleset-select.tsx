import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_RULESET, rosterSizeOf, type Ruleset } from '@/lib/draft-center/ruleset';
import type { ApiRuleset } from '@/lib/api';

const DEFAULT_VALUE = '__default__';

const summary = (r: Pick<Ruleset, 'pointCap' | 'teraEnabled' | 'rosterSize' | 'rosterMin' | 'rosterMax'>) =>
  `${r.pointCap}pt, ${rosterSizeOf(r)} slots${r.teraEnabled ? '' : ', no tera'}`;

/** Ruleset picker: default, the active season's instances, and templates (labelled as such). */
export function RulesetSelect({ rulesets, current, onChange, className }: {
  rulesets: ApiRuleset[];
  /** The team's resolved ruleset (id absent for the built-in default / legacy league-derived). */
  current: Ruleset;
  onChange: (rulesetId: number | null) => void;
  className?: string;
}) {
  const templates = rulesets.filter(r => r.isTemplate);
  const instances = rulesets.filter(r => !r.isTemplate);
  // A team can point at a ruleset that is no longer listed (older season) - keep it selectable.
  const orphan = current.id != null && !rulesets.some(r => r.id === current.id);
  const value = current.id != null ? String(current.id) : DEFAULT_VALUE;

  return (
    <Select value={value} onValueChange={v => onChange(!v || v === DEFAULT_VALUE ? null : Number(v))}>
      <SelectTrigger size="sm" className={className} aria-label="Ruleset">
        <SelectValue>{current.label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={DEFAULT_VALUE}>{DEFAULT_RULESET.label} ({summary(DEFAULT_RULESET)})</SelectItem>
        {orphan && <SelectItem value={value}>{current.label} ({summary(current)})</SelectItem>}
        {instances.length > 0 && (
          <SelectGroup>
            <SelectLabel>Current season</SelectLabel>
            {instances.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name} ({summary(r)})</SelectItem>)}
          </SelectGroup>
        )}
        {templates.length > 0 && (
          <SelectGroup>
            <SelectLabel>Templates</SelectLabel>
            {templates.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name} ({summary(r)})</SelectItem>)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
