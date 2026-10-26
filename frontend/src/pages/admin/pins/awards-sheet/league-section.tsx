/**
 * One league's block in the Awards Sheet: a row per team.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Check, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { TeamLink } from '@/components/team-link';
import { CoachLink } from '@/components/coach-link';
import { cn } from '@/lib/utils';
import type { ApiPinDefinition, ApiPinSuggestion, ApiPinUnresolved, ApiSeasonPin } from '@/lib/api';
import { RosterPicker } from './roster-picker';
import {
  rowFromSuggestion, rowKey, sameRow, rowFromPin,
  type SheetLeague, type SheetRow, type SheetTeam,
} from './types';

type Status = 'awarded' | 'unsaved' | 'suggested' | 'tie' | 'missing';

const CHIP: Record<Status, { label: string; cls: string }> = {
  awarded: { label: 'Awarded', cls: 'bg-win/15 text-win' },
  unsaved: { label: 'Unsaved', cls: 'bg-amber-400/15 text-amber-400' },
  suggested: { label: 'Suggested', cls: 'bg-cyan-400/15 text-cyan-400' },
  tie: { label: 'Tie', cls: 'bg-draw/15 text-draw' },
  missing: { label: 'Missing', cls: 'bg-surface-overlay text-text-muted' },
};

function StatusChip({ status, draft }: { status: Status; draft?: boolean }) {
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider', CHIP[status].cls)}>
      {CHIP[status].label}{draft && status === 'awarded' ? ' - draft' : ''}
    </span>
  );
}

function Tick({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors',
        on ? 'border-neon bg-neon/20 text-neon' : 'border-border-default text-transparent hover:border-text-muted',
      )}
    >
      <Check size={13} />
    </button>
  );
}

interface SectionProps {
  league: SheetLeague;
  def: ApiPinDefinition;
  rows: Map<string, SheetRow>;
  setRows: (fn: (m: Map<string, SheetRow>) => void) => void;
  existing: Map<string, ApiSeasonPin>;
  suggestions: ApiPinSuggestion[];
  unresolved: ApiPinUnresolved[];
  rowErrors: Record<string, string>;
  /** Right-aligned header action (per-league publish). */
  action?: ReactNode;
}

export function LeagueSection(p: SectionProps) {
  const { league, def, rows, unresolved } = p;
  const fields = def.metadataFields ?? [];
  const teamIds = new Set(league.teams.map(t => t.id));
  const awardedHere = [...rows.values()].filter(r => teamIds.has(r.teamId)).length;
  const myUnresolved = unresolved.filter(u => u.leagueId === league.id);
  const missing = awardedHere === 0;

  return (
    <section className="rounded-md border border-border-default bg-surface-raised/30">
      <header className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: league.color }} />
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider">{league.name}</h3>
        <span className="font-mono text-[10px] text-text-muted tabular-nums">{awardedHere} selected</span>
        {missing && <StatusChip status="missing" />}
        <div className="ml-auto">{p.action}</div>
      </header>

      {myUnresolved.length > 0 && (
        <div className="flex flex-col gap-0.5 border-b border-border-subtle bg-amber-400/5 px-3 py-1.5 text-[11px] text-amber-400">
          {myUnresolved.map((u, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <AlertTriangle size={11} className="shrink-0" />
              No suggestion: {u.detail}
            </span>
          ))}
        </div>
      )}

      <div className="divide-y divide-border-subtle">
        {league.teams.map(t => <TeamRow key={t.id} team={t} fields={fields} {...p} />)}
      </div>
    </section>
  );
}

function TeamRow({
  team, def, fields, rows, setRows, existing, suggestions, rowErrors,
}: SectionProps & { team: SheetTeam; fields: readonly string[] }) {
  const key = rowKey(team.id);
  const row = rows.get(key);
  const saved = existing.get(key);
  const sugg = suggestions.filter(s => s.teamId === team.id);
  const first = sugg[0];
  const wantsMon = fields.includes('pokemon');
  const wantsNick = fields.includes('nickname');
  // Team-scoped pins with a Pokemon: the picker IS the control (empty = no award).
  const pickerMode = def.scope === 'team' && wantsMon;

  let status: Status;
  if (row) status = saved && sameRow(rowFromPin(saved), row) ? 'awarded' : 'unsaved';
  else if (first) status = sugg.some(s => s.tie) ? 'tie' : 'suggested';
  else status = 'missing';

  const select = () => setRows(m => m.set(key, first ? rowFromSuggestion(first) : { teamId: team.id }));
  const clear = () => setRows(m => { m.delete(key); });
  const patch = (c: Partial<SheetRow>) => setRows(m => { m.set(key, { ...(m.get(key) ?? { teamId: team.id }), ...c }); });
  const missingInput = row && ((wantsMon && !row.pokemon) || (wantsNick && !row.nickname?.trim()));

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2', rowErrors[key] && 'bg-loss/5')}>
      {!pickerMode && <Tick on={!!row} onClick={row ? clear : select} label={`Award to ${team.teamName}`} />}
      <div className="flex min-w-[9rem] flex-1 basis-40 flex-col">
        <TeamLink
          team={{ leagueId: team.leagueId, teamId: team.id, teamName: team.teamName, teamAbbrev: team.teamAbbrev, teamColor: team.teamColor }}
          size="sm"
        />
        <span className="truncate text-[10px] text-text-muted">
          {team.owner ? <CoachLink coach={team.owner} noHoverCard /> : 'No linked coach'}
        </span>
      </div>
      <StatusChip status={status} draft={!!saved && !saved.published} />
      {first && !row && (
        <span className="min-w-0 flex-1 basis-40 truncate text-[11px] text-text-secondary" title={first.reason}>
          {first.pokemon ? `${first.pokemon} - ` : ''}{first.reason}
          {sugg.length > 1 && ` (+${sugg.length - 1} tied)`}
        </span>
      )}
      {first && !row && !pickerMode && (
        <button type="button" onClick={select} className="inline-flex h-7 items-center gap-1 rounded border border-cyan-400/40 px-2 text-[11px] text-cyan-400 hover:bg-cyan-400/10">
          <Plus size={11} />Accept
        </button>
      )}
      {(wantsMon && (row || pickerMode)) && (
        <RosterPicker
          roster={team.roster}
          value={row?.pokemon}
          clearable={pickerMode}
          invalid={!!missingInput && !row?.pokemon}
          onChange={mon => (mon == null ? clear() : patch({ pokemon: mon }))}
        />
      )}
      {wantsNick && row && (
        <Input
          value={row.nickname ?? ''}
          onChange={e => patch({ nickname: e.target.value })}
          placeholder="Nickname"
          maxLength={60}
          className={cn('h-7 w-full max-w-[10rem] text-xs', !row.nickname?.trim() && 'border-loss')}
        />
      )}
      {fields.includes('note') && row && (
        <Input
          value={row.note ?? ''}
          onChange={e => patch({ note: e.target.value })}
          placeholder="Note"
          maxLength={200}
          className="h-7 w-full max-w-[12rem] text-xs"
        />
      )}
      {rowErrors[key] && <span className="w-full text-[11px] text-loss">{rowErrors[key]}</span>}
    </div>
  );
}
