import { Link } from 'react-router-dom';
import { Copy, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { rulesetFromLeague, DEFAULT_RULESET, type Ruleset } from '@/lib/draft-center/ruleset';
import { validateTeam, warnCount } from '@/lib/draft-center/rules';
import type { DcTeam } from '@/lib/draft-center/types';
import type { League } from '@/lib/types';
import { useMemo } from 'react';

const fmtDate = (iso: string) => {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function TeamCard({ team, leagues, onDuplicate, onDelete }: {
  team: DcTeam; leagues: League[]; onDuplicate: () => void; onDelete: () => void;
}) {
  const ruleset: Ruleset = useMemo(() => {
    const l = team.leagueId ? leagues.find(x => x.id === team.leagueId) : undefined;
    return l ? rulesetFromLeague(l) : DEFAULT_RULESET;
  }, [team.leagueId, leagues]);
  const v = useMemo(() => validateTeam(team.roster, ruleset), [team.roster, ruleset]);
  const warns = warnCount(v);
  const captains = team.roster.filter(m => m.captain).length;
  const pct = Math.min(100, (v.used / Math.max(1, v.budget)) * 100);

  return (
    <div className="group relative rounded-lg border border-border-default bg-surface-raised/50 hover:border-emerald-400/40 transition-colors min-w-0">
      <Link to={`/draft-center/team/${team.id}`} className="block p-3 pb-2.5 min-w-0" aria-label={`Open ${team.name}`}>
        <div className="flex items-center gap-2 min-w-0 pr-14">
          <span className="truncate font-mono font-semibold text-sm">{team.name}</span>
          {team.shareToken && <span className="shrink-0 text-[9px] font-mono uppercase text-neon border border-neon/40 rounded px-1">shared</span>}
        </div>
        <div className="text-[10px] font-mono text-text-muted truncate mb-2">{ruleset.label}</div>

        <div className="flex flex-wrap gap-0 min-h-12 content-start">
          {team.roster.length === 0
            ? <span className="text-xs text-text-muted italic py-3">Empty - open to add Pokemon</span>
            : team.roster.map(m => (
              <span key={m.name} className={cn('relative', m.captain && 'rounded ring-1 ring-pink-400/50')} title={m.name}>
                <PokemonSprite name={m.name} size="sm" />
              </span>
            ))}
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-text-muted">
          <div className="flex-1 h-1.5 rounded-full bg-surface-overlay overflow-hidden min-w-0">
            <div className={cn('h-full rounded-full', v.used > v.budget ? 'bg-loss' : 'bg-neon')} style={{ width: `${pct}%` }} />
          </div>
          <span className={cn('tabular-nums shrink-0', v.used > v.budget && 'text-loss')}>{v.used}/{v.budget}</span>
          <span className="tabular-nums shrink-0">{v.count}/{v.rosterSize}</span>
          {captains > 0 && <span className="inline-flex items-center gap-0.5 text-pink-400 shrink-0"><Sparkles size={10} />{captains}</span>}
          {warns > 0 && (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex items-center gap-0.5 text-amber-400 shrink-0" />}>
                <TriangleAlert size={11} />{warns}
              </TooltipTrigger>
              <TooltipContent side="top"><ul>{v.violations.filter(x => x.severity === 'warn').map((x, i) => <li key={i}>{x.message}</li>)}</ul></TooltipContent>
            </Tooltip>
          )}
          <span className="ml-auto shrink-0">{fmtDate(team.updatedAt)}</span>
        </div>
      </Link>

      <div className="absolute top-1.5 right-1.5 flex opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button type="button" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate team"
          className="size-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay"><Copy size={13} /></button>
        <button type="button" onClick={onDelete} title="Delete" aria-label="Delete team"
          className="size-7 rounded-md flex items-center justify-center text-text-muted hover:text-loss hover:bg-surface-overlay"><Trash2 size={13} /></button>
      </div>
    </div>
  );
}
