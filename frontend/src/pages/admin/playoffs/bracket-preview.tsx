import { Trophy } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { cn } from '@/lib/utils';
import type { PlayoffStandingRow } from '@/lib/api-playoffs';

type Slot = { seed: number } | { tbd: string };
type Col = { label: string; games: [Slot, Slot][] };

const s = (seed: number): Slot => ({ seed });
const w = (t: string): Slot => ({ tbd: `Winner ${t}` });

/** Same shapes as backend buildPlayoffMatchups (2 / 4 / 6 / 8 teams). */
function columns(topN: number): Col[] {
  if (topN === 8) return [
    { label: 'Quarter Finals', games: [[s(1), s(8)], [s(4), s(5)], [s(2), s(7)], [s(3), s(6)]] },
    { label: 'Semi Finals', games: [[w('QF1'), w('QF2')], [w('QF3'), w('QF4')]] },
    { label: 'Finals', games: [[w('SF1'), w('SF2')]] },
  ];
  if (topN === 6) return [
    { label: 'Quarter Finals', games: [[s(3), s(6)], [s(4), s(5)]] },
    { label: 'Semi Finals', games: [[s(1), w('QF1')], [s(2), w('QF2')]] },
    { label: 'Finals', games: [[w('SF1'), w('SF2')]] },
  ];
  if (topN === 4) return [
    { label: 'Semi Finals', games: [[s(1), s(4)], [s(2), s(3)]] },
    { label: 'Finals', games: [[w('SF1'), w('SF2')]] },
  ];
  return [{ label: 'Finals', games: [[s(1), s(2)]] }];
}

export function BracketPreview({ order, topN, standings }: { order: string[]; topN: number; standings: PlayoffStandingRow[] }) {
  const byId = new Map(standings.map(t => [t.teamId, t]));
  const cols = columns(topN);
  return (
    // overflow-x-auto: the mockup's finals column clipped with no recovery.
    <div className="flex gap-4 items-stretch overflow-x-auto pb-2">
      {cols.map((c, ci) => (
        <div key={c.label} className={cn('flex flex-col gap-3 min-w-[190px] flex-1', ci > 0 && 'justify-around')}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted text-center">{c.label}</div>
          {c.games.map((g, gi) => (
            <div key={gi} className="rounded-lg border border-border-default bg-surface-raised overflow-hidden">
              <Row slot={g[0]} order={order} byId={byId} />
              <div className="h-px bg-border-subtle" />
              <Row slot={g[1]} order={order} byId={byId} />
            </div>
          ))}
          {ci === cols.length - 1 && (
            <div className="flex items-center justify-center gap-1 text-[10px] text-draw font-mono">
              <Trophy size={12} /> Champion
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ slot, order, byId }: { slot: Slot; order: string[]; byId: Map<string, PlayoffStandingRow> }) {
  if ('tbd' in slot) return <div className="px-3 py-2.5 text-xs text-text-muted">{slot.tbd}</div>;
  const t = byId.get(order[slot.seed - 1] ?? '');
  if (!t) return <div className="px-3 py-2.5 text-xs text-text-muted">#{slot.seed} TBD</div>;
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-[10px] font-mono text-pink w-5 shrink-0">#{slot.seed}</span>
      <TeamLogo abbrev={t.abbrev} color={t.color} size="xs" />
      <span className="text-xs text-text-primary truncate min-w-0">{t.teamName}</span>
    </div>
  );
}
