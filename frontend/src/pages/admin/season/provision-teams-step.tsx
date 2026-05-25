import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import { Users, Copy, Trash2, Plus, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

export interface TeamRow {
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  managerUsername: string;
  coachName: string;
}

export interface LeagueTeamsState {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  count: number;
  rows: TeamRow[];
  cloneSourceSeasonId?: number | null;
  cloneSourceLeagueId?: string | null;
}

function emptyRow(): TeamRow {
  return { teamName: '', teamAbbrev: '', teamColor: '#888888', managerUsername: '', coachName: '' };
}

function fitRows(rows: TeamRow[], count: number): TeamRow[] {
  if (rows.length === count) return rows;
  if (rows.length > count) return rows.slice(0, count);
  return [...rows, ...Array.from({ length: count - rows.length }, emptyRow)];
}

interface PriorSeasonOption {
  id: number;
  seasonNumber: number;
}

export function ProvisionTeamsStep({
  state,
  setState,
  defaultMaxTeams,
}: {
  state: LeagueTeamsState[];
  setState: (next: LeagueTeamsState[]) => void;
  defaultMaxTeams: number;
}) {
  const [activeLeagueIdx, setActiveLeagueIdx] = useState(0);
  const [priorSeasons, setPriorSeasons] = useState<PriorSeasonOption[]>([]);
  const [seasonLeagueCache, setSeasonLeagueCache] = useState<Record<number, Awaited<ReturnType<typeof api.getSeasonLeagues>>>>({});

  useEffect(() => {
    api.getSeasons()
      .then(rows => setPriorSeasons(rows.map(r => ({ id: r.id, seasonNumber: r.seasonNumber }))))
      .catch(() => setPriorSeasons([]));
  }, []);

  const active = state[activeLeagueIdx];
  if (!active) {
    return (
      <div className="text-sm text-text-muted p-4 text-center">
        No leagues selected. Go back to step 2 and pick at least one.
      </div>
    );
  }

  function patchLeague(idx: number, patch: Partial<LeagueTeamsState>) {
    setState(state.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  function setRow(rowIdx: number, patch: Partial<TeamRow>) {
    const rows = active.rows.map((r, i) => i === rowIdx ? { ...r, ...patch } : r);
    patchLeague(activeLeagueIdx, { rows });
  }

  function setCount(n: number) {
    patchLeague(activeLeagueIdx, { count: n, rows: fitRows(active.rows, n) });
  }

  async function cloneFrom(seasonId: number, leagueId: string) {
    let cached = seasonLeagueCache[seasonId];
    if (!cached) {
      try {
        cached = await api.getSeasonLeagues(seasonId);
        setSeasonLeagueCache(prev => ({ ...prev, [seasonId]: cached! }));
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load prior season teams'));
        return;
      }
    }
    const src = cached.find(l => l.id === leagueId);
    if (!src) {
      toast.error('Source league not found');
      return;
    }
    const rows: TeamRow[] = src.teams.map(t => ({
      teamName: t.teamName,
      teamAbbrev: t.teamAbbrev,
      teamColor: t.teamColor,
      coachName: t.coachName,
      managerUsername: '',
    }));
    patchLeague(activeLeagueIdx, {
      rows: fitRows(rows, Math.max(rows.length, active.count)),
      count: Math.max(rows.length, active.count),
      cloneSourceSeasonId: seasonId,
      cloneSourceLeagueId: leagueId,
    });
    toast.success(`Cloned ${rows.length} teams from S${priorSeasons.find(s => s.id === seasonId)?.seasonNumber ?? '?'} ${src.name}`);
  }

  function clearRows() {
    patchLeague(activeLeagueIdx, {
      rows: Array.from({ length: active.count }, emptyRow),
      cloneSourceSeasonId: null,
      cloneSourceLeagueId: null,
    });
  }

  // Validation summary
  const filledCount = active.rows.filter(r => r.teamName.trim() && r.teamAbbrev.trim()).length;
  const dupAbbrevs = (() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of active.rows) {
      const a = r.teamAbbrev.trim().toLowerCase();
      if (!a) continue;
      if (seen.has(a)) dup.add(a);
      seen.add(a);
    }
    return dup;
  })();

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Provision teams per league. Default = {defaultMaxTeams} teams. Leave manager blank to assign later.
      </p>

      {/* League tabs */}
      {state.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {state.map((l, i) => {
            const ok = l.rows.filter(r => r.teamName.trim() && r.teamAbbrev.trim()).length;
            return (
              <button
                key={l.leagueId}
                onClick={() => setActiveLeagueIdx(i)}
                className={`px-2.5 py-1 rounded-md border text-xs whitespace-nowrap transition-colors ${
                  i === activeLeagueIdx
                    ? 'border-pink bg-pink/10 text-text-primary'
                    : 'border-border text-text-muted hover:border-border-default'
                }`}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: l.leagueColor }} />
                {l.leagueName}
                <span className="ml-1.5 text-[10px] text-text-muted">{ok}/{l.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-pink" />
          <label className="text-xs text-text-muted">Team count</label>
          <NumberInput value={active.count} onChange={setCount} min={2} max={32} className="w-20" />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <CloneFromMenu
            priorSeasons={priorSeasons}
            cache={seasonLeagueCache}
            loadSeasonLeagues={async (sid) => {
              if (seasonLeagueCache[sid]) return seasonLeagueCache[sid];
              const rows = await api.getSeasonLeagues(sid);
              setSeasonLeagueCache(prev => ({ ...prev, [sid]: rows }));
              return rows;
            }}
            onPick={cloneFrom}
          />
          <Button size="xs" variant="ghost" onClick={clearRows}>
            <Trash2 size={12} /> Clear
          </Button>
        </div>
      </div>

      {active.cloneSourceSeasonId && (
        <div className="text-[10px] text-text-muted">
          Cloned from S{priorSeasons.find(s => s.id === active.cloneSourceSeasonId)?.seasonNumber ?? '?'} ·{' '}
          {active.cloneSourceLeagueId} — managers cleared, edit below to re-assign.
        </div>
      )}

      {/* Header + rows */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_70px_50px_1fr_30px] gap-2 px-2 py-1.5 bg-surface-overlay text-[10px] uppercase tracking-wide text-text-muted">
          <span>Team Name</span>
          <span>Abbr</span>
          <span>Color</span>
          <span>Manager (username)</span>
          <span></span>
        </div>
        <div className="max-h-[280px] overflow-y-auto divide-y divide-border-subtle">
          {active.rows.map((r, i) => {
            const isDup = !!r.teamAbbrev && dupAbbrevs.has(r.teamAbbrev.trim().toLowerCase());
            return (
              <div key={i} className="grid grid-cols-[1fr_70px_50px_1fr_30px] gap-2 px-2 py-1 items-center">
                <Input
                  value={r.teamName}
                  onChange={e => setRow(i, { teamName: e.target.value })}
                  placeholder={`Team ${i + 1}`}
                  className="h-7 text-xs"
                />
                <Input
                  value={r.teamAbbrev}
                  onChange={e => setRow(i, { teamAbbrev: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() })}
                  placeholder="ABV"
                  className={`h-7 text-xs font-mono ${isDup ? 'border-loss' : ''}`}
                />
                <input
                  type="color"
                  value={r.teamColor}
                  onChange={e => setRow(i, { teamColor: e.target.value })}
                  className="h-7 w-full rounded border border-border bg-surface-base cursor-pointer"
                />
                <Input
                  value={r.managerUsername}
                  onChange={e => setRow(i, { managerUsername: e.target.value })}
                  placeholder="(optional)"
                  className="h-7 text-xs"
                />
                <button
                  onClick={() => {
                    const rows = active.rows.filter((_, idx) => idx !== i);
                    patchLeague(activeLeagueIdx, {
                      count: Math.max(rows.length, 0),
                      rows: rows.length === 0 ? [emptyRow()] : rows,
                    });
                  }}
                  className="text-text-muted hover:text-loss transition-colors flex items-center justify-center"
                  title="Remove row"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => patchLeague(activeLeagueIdx, {
            count: active.count + 1,
            rows: [...active.rows, emptyRow()],
          })}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] text-text-muted hover:text-neon hover:bg-neon/5 transition-colors border-t border-border-subtle"
        >
          <Plus size={11} /> Add row
        </button>
      </div>

      <div className="flex items-center justify-between text-[10px]">
        <span className="text-text-muted">
          {filledCount}/{active.count} team rows filled
          {dupAbbrevs.size > 0 && (
            <span className="text-loss ml-2">· duplicate abbrevs: {Array.from(dupAbbrevs).join(', ')}</span>
          )}
        </span>
        {filledCount < active.count && (
          <span className="text-draw flex items-center gap-1">
            <AlertTriangle size={10} /> incomplete rows will be skipped
          </span>
        )}
      </div>
    </div>
  );
}

function CloneFromMenu({
  priorSeasons,
  cache,
  loadSeasonLeagues,
  onPick,
}: {
  priorSeasons: PriorSeasonOption[];
  cache: Record<number, Awaited<ReturnType<typeof api.getSeasonLeagues>>>;
  loadSeasonLeagues: (seasonId: number) => Promise<Awaited<ReturnType<typeof api.getSeasonLeagues>>>;
  onPick: (seasonId: number, leagueId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [seasonId, setSeasonId] = useState<number | null>(null);

  async function pickSeason(id: number) {
    setSeasonId(id);
    if (!cache[id]) await loadSeasonLeagues(id).catch(() => {});
  }

  if (priorSeasons.length === 0) {
    return (
      <Button size="xs" variant="outline" disabled title="No prior seasons available">
        <Copy size={12} /> Clone
      </Button>
    );
  }

  return (
    <div className="relative">
      <Button size="xs" variant="outline" onClick={() => setOpen(o => !o)}>
        <Copy size={12} /> Clone from prior
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-surface-base shadow-lg p-2 space-y-1">
          {seasonId === null ? (
            <>
              <div className="text-[10px] uppercase tracking-wide text-text-muted px-1.5 py-1">Pick season</div>
              {priorSeasons.map(s => (
                <button
                  key={s.id}
                  onClick={() => pickSeason(s.id)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface-overlay"
                >
                  Season {s.seasonNumber}
                </button>
              ))}
            </>
          ) : (
            <>
              <button
                onClick={() => setSeasonId(null)}
                className="text-[10px] text-text-muted px-1.5 py-0.5 hover:text-text-primary"
              >
                ← back
              </button>
              <div className="text-[10px] uppercase tracking-wide text-text-muted px-1.5 py-1">Pick league</div>
              {(cache[seasonId] ?? []).length === 0 ? (
                <div className="text-xs text-text-muted px-2 py-1">Loading…</div>
              ) : (
                cache[seasonId].map(l => (
                  <button
                    key={l.id}
                    onClick={() => { onPick(seasonId, l.id); setOpen(false); setSeasonId(null); }}
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface-overlay flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.name}
                    <Badge variant="outline" className="ml-auto text-[9px]">{l.teams.length}</Badge>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
