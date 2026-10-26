import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import { validateTeam } from '@/lib/draft-center/rules';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import type { DcMon } from '@/lib/draft-center/types';
import { AnalysisTabs } from './analysis/analysis-tabs';
import { BudgetMeter, Violations } from './editor/status-bar';

/** Read-only team: header, roster strip, budget/rule check and the full analysis tabs. */
export function ReadOnlyView({ title, meta, actions, roster, ruleset, backTo }: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  roster: DcMon[];
  ruleset: Ruleset;
  backTo?: string;
}) {
  const v = useMemo(() => validateTeam(roster, ruleset), [roster, ruleset]);
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-2 flex-wrap">
        {backTo && <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to={backTo} />} aria-label="Back"><ArrowLeft size={15} /></Button>}
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="font-mono font-bold text-lg truncate">{title}</h2>
          {meta && <div className="text-xs text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-0.5">{meta}</div>}
        </div>
        {actions && <div className="flex items-center gap-1.5 flex-wrap">{actions}</div>}
      </div>

      <div className="flex flex-wrap gap-0.5 rounded-lg border border-border-default bg-surface-raised/40 p-1.5">
        {roster.length === 0
          ? <span className="text-xs text-text-muted p-1">Empty roster</span>
          : roster.map(m => (
            <Link key={m.name} to={pokemonRoute(m.name)} title={m.name} className={m.captain ? 'rounded ring-1 ring-pink-400/60' : 'rounded'}>
              <PokemonSprite name={m.name} size="md" />
            </Link>
          ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
        <BudgetMeter v={v} roster={roster} ruleset={ruleset} />
        <Violations v={v} />
      </div>

      <AnalysisTabs roster={roster} ruleset={ruleset} />
    </div>
  );
}
