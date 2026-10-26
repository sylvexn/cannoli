import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDraftCenter } from '@/lib/draft-center/store';
import { useRulesetCatalog } from '@/lib/draft-center/use-ruleset-catalog';
import { validateTeam } from '@/lib/draft-center/rules';
import { cn } from '@/lib/utils';
import { SIDE_STYLE } from './common';
import { BudgetSection, RolesSection, SharedSection, SpeedSection, TypesSection, type Cmp } from './sections';

function TeamPicker({ side, value, onChange, teams }: {
  side: 'a' | 'b'; value: string; onChange: (id: string) => void; teams: { id: string; name: string }[];
}) {
  const name = teams.find(t => t.id === value)?.name;
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1 basis-48">
      <span className={cn('shrink-0 size-5 rounded text-[10px] font-mono font-bold flex items-center justify-center text-black', SIDE_STYLE[side].bg)}>{side.toUpperCase()}</span>
      <Select value={value} onValueChange={v => v && onChange(v)}>
        <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={`Team ${side.toUpperCase()}`}>
          <SelectValue>{name ?? 'Pick a team'}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Side-by-side comparison of two of the user's own Draft Center teams: /draft-center/compare?a=&b= */
export function ComparePage() {
  const store = useDraftCenter();
  const [params, setParams] = useSearchParams();
  const { resolve, loading: rsLoading } = useRulesetCatalog(store.teams);
  const aId = params.get('a') ?? '';
  const bId = params.get('b') ?? '';
  const teamA = store.getTeam(aId);
  const teamB = store.getTeam(bId);

  const set = (a: string, b: string) => setParams({ a, b }, { replace: true });

  const [A, B] = useMemo<[Cmp | null, Cmp | null]>(() => {
    const mk = (team: typeof teamA): Cmp | null => {
      if (!team) return null;
      const ruleset = resolve(team);
      return { team, ruleset, v: validateTeam(team.roster, ruleset) };
    };
    return [mk(teamA), mk(teamB)];
  }, [teamA, teamB, resolve]);

  if (store.loading || rsLoading) return <div className="p-8 text-sm text-text-muted">Loading...</div>;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/draft-center" />} aria-label="Back to teams"><ArrowLeft size={15} /></Button>
        <h2 className="text-lg font-mono font-bold tracking-tight uppercase">
          <span className="text-sky-400">Compare</span>{' '}
          <span className="text-text-primary">Teams</span>
        </h2>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <TeamPicker side="a" value={aId} onChange={id => set(id, bId)} teams={store.teams} />
        <Button variant="outline" size="icon-sm" onClick={() => set(bId, aId)} aria-label="Swap teams" title="Swap"><ArrowLeftRight size={14} /></Button>
        <TeamPicker side="b" value={bId} onChange={id => set(aId, id)} teams={store.teams} />
      </div>

      {!A || !B ? (
        <div className="rounded-lg border border-dashed border-border-default p-8 text-center text-sm text-text-muted">
          {store.teams.length < 2
            ? 'You need at least two teams to compare.'
            : 'Pick two of your teams to compare them.'}
        </div>
      ) : (
        <>
          <BudgetSection a={A} b={B} />
          <TypesSection a={A} b={B} />
          <SpeedSection a={A} b={B} />
          <RolesSection a={A} b={B} />
          <SharedSection a={A} b={B} />
        </>
      )}
    </div>
  );
}
