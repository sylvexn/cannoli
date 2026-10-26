import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, GripVertical, ListOrdered } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TeamLogo } from '@/components/team-logo';
import { cn } from '@/lib/utils';
import type { PlayoffStandingRow } from '@/lib/api-playoffs';

const RULE_LABEL = { h2h: 'head-to-head', diff: 'point differential', kills: 'kills', id: 'team id' } as const;

/** Seed list: drag a row onto another to SWAP them; arrows are the keyboard/touch path. */
export function SeedEditor({ leagueId, order, topN, standings, disabled, onChange }: {
  leagueId: string; order: string[]; topN: number; standings: PlayoffStandingRow[];
  disabled?: boolean; onChange: (o: string[]) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const byId = new Map(standings.map(s => [s.teamId, s]));
  const swap = (a: number, b: number) => {
    if (disabled || a === b || b < 0 || b >= order.length) return;
    const n = [...order];
    [n[a], n[b]] = [n[b]!, n[a]!];
    onChange(n);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-text-secondary font-medium">
          Seeding <span className="text-text-muted">(drag to swap, or use arrows)</span>
        </div>
        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 shrink-0" disabled={disabled}
          onClick={() => onChange(standings.map(s => s.teamId))}>
          <ListOrdered size={10} /> Reset to standings
        </Button>
      </div>
      <ul className="space-y-0.5">
        {order.map((id, i) => {
          const t = byId.get(id);
          if (!t) return null;
          const delta = t.rank - 1 - i; // positive = moved up vs standings
          const inBracket = i < topN;
          return (
            <li key={id}>
              {i === topN && (
                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-loss/40" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-loss/70">Missed playoffs</span>
                  <div className="h-px flex-1 bg-loss/40" />
                </div>
              )}
              <div
                draggable={!disabled}
                onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={e => { e.preventDefault(); setOver(i); }}
                onDragLeave={() => setOver(o => (o === i ? null : o))}
                onDrop={e => { e.preventDefault(); if (drag !== null) swap(drag, i); setDrag(null); setOver(null); }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors',
                  !disabled && 'cursor-grab active:cursor-grabbing',
                  drag === i && 'opacity-40',
                  over === i && drag !== null && drag !== i
                    ? 'border-pink bg-pink/10'
                    : 'border-border-subtle bg-surface-raised/40 hover:bg-surface-overlay/40',
                  !inBracket && 'opacity-60',
                )}
              >
                <GripVertical size={12} className="text-text-muted/40 shrink-0" />
                <span className={cn('text-xs font-mono font-bold tabular-nums w-6 text-center shrink-0', inBracket ? 'text-pink' : 'text-text-muted')}>
                  {inBracket ? `#${i + 1}` : '-'}
                </span>
                <TeamLogo abbrev={t.abbrev} color={t.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link to={`/league/${leagueId}/teams/${t.teamId}`} className="text-xs text-text-primary hover:underline truncate block">{t.teamName}</Link>
                  <div className="text-[10px] text-text-muted truncate">{t.coachName}{!t.hasCoach && ' (no coach linked)'}</div>
                </div>
                {t.tiebreaker && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="hidden sm:inline-flex text-[9px] px-1 h-4 border-draw/40 text-draw shrink-0">tiebreak</Badge>
                    </TooltipTrigger>
                    <TooltipContent>Tied on wins; ordered by {RULE_LABEL[t.tiebreaker.rule]} ({String(t.tiebreaker.value)})</TooltipContent>
                  </Tooltip>
                )}
                <span className="hidden sm:inline text-[10px] font-mono text-text-muted shrink-0" title="Standings finish">std #{t.rank}</span>
                <span className={cn('text-[10px] font-mono shrink-0 w-6 text-right', delta > 0 ? 'text-win' : delta < 0 ? 'text-loss' : 'text-transparent')}>
                  {delta > 0 ? `+${delta}` : delta < 0 ? delta : '0'}
                </span>
                <Badge variant="outline" className="text-[9px] px-1 h-4 border-border-subtle text-text-muted font-mono shrink-0">{t.wins}-{t.losses}</Badge>
                <div className="flex shrink-0">
                  <button aria-label={`Move ${t.teamName} up`} disabled={disabled || i === 0} onClick={() => swap(i, i - 1)}
                    className="h-7 w-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30 disabled:pointer-events-none"><ChevronUp size={14} /></button>
                  <button aria-label={`Move ${t.teamName} down`} disabled={disabled || i === order.length - 1} onClick={() => swap(i, i + 1)}
                    className="h-7 w-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30 disabled:pointer-events-none"><ChevronDown size={14} /></button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
