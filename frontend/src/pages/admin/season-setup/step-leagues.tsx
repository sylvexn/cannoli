import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Switch } from '@/components/ui/switch';
import type { ApiRuleset, ApiSeasonSetupDefaults } from '@/lib/api';
import { leagueId, newLeague, slugify, type Draft, type SetupLeague } from './logic';

const SWATCHES = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#9333ea', '#ec4899'];

export function StepLeagues({ draft, patch, defaults, templates, latest }: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  defaults: ApiSeasonSetupDefaults;
  templates: ApiRuleset[];
  latest: number;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[5]);
  const prev = defaults.source?.seasonNumber;
  const setLeague = (key: string, p: Partial<SetupLeague>) =>
    patch({ leagues: draft.leagues.map(l => l.key === key ? { ...l, ...p } : l) });
  const slug = slugify(name);
  const dup = !!slug && draft.leagues.some(l => l.slug === slug);

  function add() {
    if (!slug || dup) return;
    patch({ leagues: [...draft.leagues, newLeague(name, color, templates)] });
    setName('');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-mono uppercase text-text-muted">Season number</label>
        <NumberInput value={draft.seasonNumber} min={1} onChange={n => patch({ seasonNumber: n })} className="w-24" />
        <span className="text-[11px] text-text-muted">(latest is {latest})</span>
      </div>

      <div className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
        {draft.leagues.length === 0 && <div className="p-3 text-xs text-text-muted">No source leagues. Add one below.</div>}
        {draft.leagues.map(l => (
          <div key={l.key} className="flex items-center gap-3 px-3 py-2">
            <Switch size="sm" checked={l.included} onCheckedChange={c => setLeague(l.key, { included: c })} />
            <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
            <span className="text-sm font-medium min-w-0 truncate">{l.name}</span>
            <span className="font-mono text-[11px] text-text-muted shrink-0">{leagueId(draft.seasonNumber, l.slug)}</span>
            <span className="ml-auto text-[11px] text-text-muted min-w-0 truncate">
              {l.sourceLeagueId ? `from S${prev} ${l.name} · ${l.expectedTeams} teams` : 'new league'}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-border-subtle p-3 space-y-2">
        <div className="text-xs font-mono uppercase text-text-muted">Add new league</div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="League name" className="h-8 w-48 text-xs"
            onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <div className="flex items-center gap-1">
            {SWATCHES.map(c => (
              <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setColor(c)}
                className={`size-5 rounded-full border-2 ${color === c ? 'border-text-primary' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <Input value={color} onChange={e => setColor(e.target.value)} className="h-8 w-24 font-mono text-xs" />
          <Button size="sm" variant="outline" onClick={add} disabled={!slug || dup} className="gap-1"><Plus size={12} />Add</Button>
        </div>
        <div className="font-mono text-[11px] text-text-muted">
          {slug ? <>{leagueId(draft.seasonNumber, slug)}{dup && <span className="text-loss ml-2">already in list</span>}</> : 'ID preview appears here'}
        </div>
      </div>
    </div>
  );
}
