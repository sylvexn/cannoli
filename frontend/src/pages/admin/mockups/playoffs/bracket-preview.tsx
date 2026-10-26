import { Trophy } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { cn } from '@/lib/utils';
import { PLAYOFF_WEEK, TEAM_BY_ID } from './data';

type Slot = { n: number; id: string } | { tbd: string };

/** Static 6-team bracket, same shape as the live PlayoffBracket (QF 3v6 / 4v5, SF 1 & 2 vs QF winners, F). */
export function BracketPreview({ order }: { order: string[] }) {
  const s = (n: number): Slot => ({ n, id: order[n - 1] });
  const cols: { label: string; week: number; games: [Slot, Slot][] }[] = [
    { label: 'Quarter Finals', week: PLAYOFF_WEEK, games: [[s(3), s(6)], [s(4), s(5)]] },
    { label: 'Semi Finals', week: PLAYOFF_WEEK + 1, games: [[s(1), { tbd: 'Winner QF1' }], [s(2), { tbd: 'Winner QF2' }]] },
    { label: 'Finals', week: PLAYOFF_WEEK + 2, games: [[{ tbd: 'Winner SF1' }, { tbd: 'Winner SF2' }]] },
  ];
  return (
    <div className="flex gap-4 items-stretch overflow-x-auto pb-2">
      {cols.map((c, ci) => (
        <div key={c.label} className={cn('flex flex-col gap-3 min-w-[190px] flex-1', ci > 0 && 'justify-around')}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted text-center">
            {c.label} - wk {c.week}
          </div>
          {c.games.map((g, gi) => (
            <div key={gi} className="rounded-lg border border-border-default bg-surface-raised overflow-hidden">
              <Row slot={g[0]} />
              <div className="h-px bg-border-subtle" />
              <Row slot={g[1]} />
            </div>
          ))}
          {ci === 2 && (
            <div className="flex items-center justify-center gap-1 text-[10px] text-draw font-mono">
              <Trophy size={12} /> Champion
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ slot }: { slot: Slot }) {
  if ('tbd' in slot) return <div className="px-3 py-2.5 text-xs text-text-muted">{slot.tbd}</div>;
  const t = TEAM_BY_ID.get(slot.id)!;
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-[10px] font-bold font-mono w-4 text-center text-text-muted shrink-0">{slot.n}</span>
      <TeamLogo abbrev={t.abbrev} color={t.color} size="sm" />
      <a href="#" onClick={e => e.preventDefault()} className="text-xs font-medium text-text-primary hover:underline min-w-0 flex-1 truncate">
        {t.abbrev}
      </a>
    </div>
  );
}
