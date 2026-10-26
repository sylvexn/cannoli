import { useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, ListOrdered } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TeamLogo } from '@/components/team-logo';
import { cn } from '@/lib/utils';
import { STANDINGS, TEAM_BY_ID, TOP_N } from './data';

/** Seed list: drag a row onto another to SWAP them; arrows are the keyboard/touch path. */
export function SeedEditor({ order, onChange }: { order: string[]; onChange: (o: string[]) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const swap = (a: number, b: number) => {
    if (a === b || b < 0 || b >= order.length) return;
    const n = [...order];
    [n[a], n[b]] = [n[b], n[a]];
    onChange(n);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-text-secondary font-medium">
          Seeding <span className="text-text-muted">(drag to swap, or use arrows)</span>
        </div>
        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 shrink-0" onClick={() => onChange(STANDINGS)}>
          <ListOrdered size={10} /> Reset to standings
        </Button>
      </div>
      <ul className="space-y-0.5">
        {order.map((id, i) => {
          const t = TEAM_BY_ID.get(id)!;
          const from = STANDINGS.indexOf(id);
          const delta = from - i; // positive = moved up vs standings
          const inBracket = i < TOP_N;
          return (
            <li key={id}>
              {i === TOP_N && (
                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-loss/40" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-loss/70">Missed playoffs</span>
                  <div className="h-px flex-1 bg-loss/40" />
                </div>
              )}
              <div
                draggable
                onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={e => { e.preventDefault(); setOver(i); }}
                onDragLeave={() => setOver(o => (o === i ? null : o))}
                onDrop={e => { e.preventDefault(); if (drag !== null) swap(drag, i); setDrag(null); setOver(null); }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-grab active:cursor-grabbing transition-colors',
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
                  <a href="#" onClick={e => e.preventDefault()} className="text-xs text-text-primary hover:underline truncate block">{t.name}</a>
                  <div className="text-[10px] text-text-muted truncate">{t.coach} - {t.division}</div>
                </div>
                {t.tiebreak && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="hidden sm:inline-flex text-[9px] px-1 h-4 border-draw/40 text-draw shrink-0">tiebreak</Badge>
                    </TooltipTrigger>
                    <TooltipContent>{t.tiebreak}</TooltipContent>
                  </Tooltip>
                )}
                <span className="hidden sm:inline text-[10px] font-mono text-text-muted shrink-0" title="Standings finish">
                  std #{from + 1}
                </span>
                <span className={cn('text-[10px] font-mono shrink-0 w-6 text-right', delta > 0 ? 'text-win' : delta < 0 ? 'text-loss' : 'text-transparent')}>
                  {delta > 0 ? `+${delta}` : delta < 0 ? delta : '0'}
                </span>
                <Badge variant="outline" className="text-[9px] px-1 h-4 border-border-subtle text-text-muted font-mono shrink-0">{t.w}-{t.l}</Badge>
                <div className="flex shrink-0">
                  <button aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => swap(i, i - 1)}
                    className="h-7 w-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30 disabled:pointer-events-none"><ChevronUp size={14} /></button>
                  <button aria-label={`Move ${t.name} down`} disabled={i === order.length - 1} onClick={() => swap(i, i + 1)}
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
