import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { emptyTeam, includedLeagues, teamComplete, type Draft, type SetupLeague, type TeamRow } from './logic';

/** Debounced live check of every typed username. `found` is lowercased; `checked` = usernames the server has answered for. */
export function useResolvedUsernames(draft: Draft) {
  const names = useMemo(
    () => [...new Set(includedLeagues(draft).flatMap(l => l.teams.map(t => t.username.trim().toLowerCase()).filter(Boolean)))].sort(),
    [draft],
  );
  const key = names.join('\n');
  const [state, setState] = useState<{ key: string; found: Set<string> }>({ key: '', found: new Set() });
  useEffect(() => {
    if (!names.length) return;
    const t = setTimeout(() => {
      api.resolveUsernames(names)
        .then(r => setState({ key, found: new Set(r.found.map(s => s.toLowerCase())) }))
        .catch(() => { /* leave unchecked */ });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const done = !names.length || state.key === key;
  return {
    /** true / false once answered, null while pending or empty */
    status: (u: string): boolean | null => {
      const n = u.trim().toLowerCase();
      return n && done ? state.found.has(n) : null;
    },
  };
}

type Status = ReturnType<typeof useResolvedUsernames>['status'];

export function unresolvedCount(l: SetupLeague, status: Status) {
  return l.teams.filter(t => status(t.username) === false).length;
}

function CloneFrom({ onRows }: { onRows: (rows: TeamRow[], label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [seasons, setSeasons] = useState<{ id: number; seasonNumber: number }[]>([]);
  const [leagues, setLeagues] = useState<Awaited<ReturnType<typeof api.getSeasonLeagues>>>([]);
  const [seasonId, setSeasonId] = useState('');

  useEffect(() => {
    if (open && !seasons.length) api.getSeasons().then(r => setSeasons(r.map(s => ({ id: s.id, seasonNumber: s.seasonNumber })))).catch(() => {});
  }, [open, seasons.length]);

  async function pickSeason(v: string) {
    setSeasonId(v);
    try { setLeagues(await api.getSeasonLeagues(Number(v))); }
    catch (e) { toast.error(getErrorMessage(e, 'Failed to load season teams')); }
  }
  const sn = seasons.find(s => String(s.id) === seasonId)?.seasonNumber;

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(o => !o)}><Copy size={12} />Clone from</Button>
      {open && (
        <>
          <Select value={seasonId} onValueChange={v => pickSeason(v ?? '')}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Season" /></SelectTrigger>
            <SelectContent>{seasons.map(s => <SelectItem key={s.id} value={String(s.id)}>Season {s.seasonNumber}</SelectItem>)}</SelectContent>
          </Select>
          <Select value="" onValueChange={id => {
            const src = leagues.find(l => l.id === id);
            if (!src) return;
            onRows(src.teams.map(t => ({ teamName: t.teamName, teamAbbrev: t.teamAbbrev, teamColor: t.teamColor, coachName: t.coachName, username: '' })), `S${sn} ${src.name}`);
            setOpen(false);
          }}>
            <SelectTrigger className="h-8 w-36 text-xs" disabled={!leagues.length}><SelectValue placeholder="League" /></SelectTrigger>
            <SelectContent>{leagues.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.teams.length})</SelectItem>)}</SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}

export function StepTeams({ draft, patch, status }: { draft: Draft; patch: (p: Partial<Draft>) => void; status: Status }) {
  const list = includedLeagues(draft);
  const [activeKey, setActiveKey] = useState(list[0]?.key ?? '');
  const active = list.find(l => l.key === activeKey) ?? list[0];
  if (!active) return <div className="text-sm text-text-muted">No leagues included.</div>;

  const setTeams = (teams: TeamRow[]) => patch({ leagues: draft.leagues.map(l => l.key === active.key ? { ...l, teams } : l) });
  const setRow = (i: number, p: Partial<TeamRow>) => setTeams(active.teams.map((t, j) => j === i ? { ...t, ...p } : t));
  const abbrCount = new Map<string, number>();
  for (const t of active.teams) { const a = t.teamAbbrev.trim().toLowerCase(); if (a) abbrCount.set(a, (abbrCount.get(a) ?? 0) + 1); }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {list.map(l => {
          const incomplete = l.teams.some(t => !teamComplete(t));
          return (
            <button key={l.key} type="button" onClick={() => setActiveKey(l.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs ${l.key === active.key ? 'border-pink bg-pink/10' : 'border-border-subtle text-text-muted hover:border-border-default'}`}>
              <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} />
              {l.name}
              <span className="font-mono text-[10px]">{l.teams.filter(teamComplete).length}/{l.expectedTeams}</span>
              {incomplete && <AlertTriangle size={11} className="text-draw" />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <CloneFrom onRows={(rows, label) => { setTeams(rows); toast.success(`Cloned ${rows.length} teams from ${label}`); }} />
        <Button size="sm" variant="ghost" className="gap-1" onClick={() => setTeams([])}><Trash2 size={12} />Clear</Button>
        <Button size="sm" variant="outline" className="gap-1 ml-auto" onClick={() => setTeams([...active.teams, emptyTeam()])}><Plus size={12} />Add team</Button>
      </div>

      <div className="rounded-lg border border-border-subtle overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[24px_minmax(0,1.4fr)_64px_minmax(0,1fr)_minmax(0,1.2fr)_28px] gap-2 px-2 py-1.5 bg-surface-overlay text-[10px] font-mono uppercase text-text-muted">
            <span /><span>Team</span><span>Abbr</span><span>Coach</span><span>Account</span><span />
          </div>
          <div className="divide-y divide-border-subtle">
            {active.teams.map((t, i) => {
              const st = status(t.username);
              const dup = !!t.teamAbbrev && (abbrCount.get(t.teamAbbrev.trim().toLowerCase()) ?? 0) > 1;
              return (
                <div key={i} className="grid grid-cols-[24px_minmax(0,1.4fr)_64px_minmax(0,1fr)_minmax(0,1.2fr)_28px] gap-2 px-2 py-1 items-center">
                  <input type="color" value={t.teamColor} onChange={e => setRow(i, { teamColor: e.target.value })}
                    aria-label="Team color" className="size-5 p-0 rounded-full border border-border bg-transparent cursor-pointer" />
                  <Input value={t.teamName} onChange={e => setRow(i, { teamName: e.target.value })} placeholder={`Team ${i + 1}`} className="h-7 text-xs" />
                  <Input value={t.teamAbbrev} onChange={e => setRow(i, { teamAbbrev: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() })}
                    placeholder="ABV" className={`h-7 text-xs font-mono ${dup ? 'border-loss' : ''}`} />
                  <Input value={t.coachName} onChange={e => setRow(i, { coachName: e.target.value })} placeholder="Coach" className="h-7 text-xs" />
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Input value={t.username} onChange={e => setRow(i, { username: e.target.value })} placeholder="username" className="h-7 text-xs min-w-0" />
                    {st === true && <Badge variant="outline" className="text-win border-win/40 shrink-0">linked</Badge>}
                    {st === false && <Badge variant="outline" className="text-loss border-loss/40 shrink-0">no such user</Badge>}
                  </div>
                  <button type="button" aria-label="Remove team" onClick={() => setTeams(active.teams.filter((_, j) => j !== i))}
                    className="text-text-muted hover:text-loss flex justify-center"><Trash2 size={12} /></button>
                </div>
              );
            })}
            {active.teams.length === 0 && <div className="p-3 text-xs text-text-muted">No teams. Clone or add some; incomplete rows are skipped on create.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
