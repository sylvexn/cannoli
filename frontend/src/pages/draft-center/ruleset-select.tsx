import { useMemo } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_RULESET, rulesetFromLeague } from '@/lib/draft-center/ruleset';
import type { League } from '@/lib/types';

const DEFAULT_VALUE = '__default__';

/** Ruleset picker: one entry per league (grouped by season), plus a generic default. */
export function RulesetSelect({ leagues, value, onChange, className }: {
  leagues: League[];
  value: string | null;
  onChange: (leagueId: string | null) => void;
  className?: string;
}) {
  const groups = useMemo(() => {
    const bySeason = new Map<number, League[]>();
    for (const l of leagues) {
      const n = l.season.seasonNumber;
      bySeason.set(n, [...(bySeason.get(n) ?? []), l]);
    }
    return [...bySeason.entries()].sort((a, b) => b[0] - a[0]);
  }, [leagues]);

  const current = value ? leagues.find(l => l.id === value) : undefined;
  const label = current ? rulesetFromLeague(current).label : DEFAULT_RULESET.label;

  return (
    <Select value={value ?? DEFAULT_VALUE} onValueChange={v => onChange(!v || v === DEFAULT_VALUE ? null : v)}>
      <SelectTrigger size="sm" className={className} aria-label="Ruleset">
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={DEFAULT_VALUE}>{DEFAULT_RULESET.label} ({DEFAULT_RULESET.pointCap}pt, {DEFAULT_RULESET.rosterSize} slots)</SelectItem>
        {groups.map(([season, ls]) => (
          <SelectGroup key={season}>
            <SelectLabel>Season {season}</SelectLabel>
            {ls.map(l => {
              const rs = rulesetFromLeague(l);
              return <SelectItem key={l.id} value={l.id}>{rs.label} ({rs.pointCap}pt, {rs.rosterSize} slots)</SelectItem>;
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
