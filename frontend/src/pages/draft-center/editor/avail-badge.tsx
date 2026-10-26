import { Link } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { OwnerMap } from '@/lib/draft-center/availability';
import type { League } from '@/lib/types';

const NONE = '__none__';

/** Subtle FA / yours / owned-by chip. Owned links to the owning team page. */
export function AvailBadge({ owners, leagueId, name, className }: {
  owners: OwnerMap | null; leagueId: string | null; name: string; className?: string;
}) {
  if (!owners || !leagueId) return null;
  const base = 'shrink-0 rounded px-1 text-[9px] font-mono uppercase leading-4 border';
  const o = owners.get(name);
  if (!o) return <span title="Free agent" className={cn(base, 'border-win/40 text-win', className)}>FA</span>;
  if (o.mine) return <span title="On your team in this league" className={cn(base, 'border-neon/40 text-neon', className)}>yours</span>;
  return (
    <Link
      to={`/league/${leagueId}/teams/${o.teamId}`}
      title={`Owned by ${o.teamName}`}
      className={cn(base, 'border-border-default text-text-muted hover:text-text-primary hover:underline max-w-24 truncate', className)}
      onClick={e => e.stopPropagation()}
    >
      owned · {o.teamAbbrev}
    </Link>
  );
}

/** "League" context picker: None or any active league. */
export function LeagueSelect({ leagues, value, onChange, className }: {
  leagues: League[]; value: string | null; onChange: (id: string | null) => void; className?: string;
}) {
  const cur = leagues.find(l => l.id === value);
  return (
    <Select value={value ?? NONE} onValueChange={v => onChange(!v || v === NONE ? null : v)}>
      <SelectTrigger size="sm" className={className} aria-label="League context">
        <SelectValue>{cur ? `League: ${cur.name}` : 'League: none'}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={NONE}>None</SelectItem>
        {leagues.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
