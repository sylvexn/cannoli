import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { readableOnDark } from '@/lib/color';
import type { Player } from '@/lib/types';
import type { DraftPickEntry, SnakeSlot } from '../types';

interface WarRoomBoardProps {
  /** Fallback column order (and the source of team identity). */
  draftOrder: Player[];
  picks: DraftPickEntry[];
  snakeOrder: SnakeSlot[];
  rosterSize: number;
  pointCap: number;
  teamPoints: Map<string, number>;
  selectedTeamId: string | null;
  userTeamId: string | null;
  /** Slot on the clock (live only) — its cell pulses. */
  currentPick: { round: number; playerId: string; overallPick: number } | null;
  /** Overall pick number the animation queue is currently landing. */
  landingPick: number | null;
  /** Formatted clock shown inside the on-the-clock cell (null = timer off). */
  clockLabel?: string | null;
  onSelectTeam: (teamId: string | null) => void;
  onOpenPokemon: (name: string) => void;
}

const FX_MS = 1600;

/** Columns = teams in first-round order, rows = rounds. Snake order only changes
 *  the pick NUMBER inside a cell, never which column it sits under. */
export function WarRoomBoard({
  draftOrder, picks, snakeOrder, rosterSize, pointCap, teamPoints,
  selectedTeamId, userTeamId, currentPick, landingPick, clockLabel, onSelectTeam, onOpenPokemon,
}: WarRoomBoardProps) {
  const columns = useMemo(() => {
    const byId = new Map(draftOrder.map(p => [p.id, p]));
    const firstRound = snakeOrder.length > 0
      ? snakeOrder.filter(s => s.round === 1).sort((a, b) => a.pick - b.pick).map(s => s.teamId)
      : picks.filter(p => p.round === 1).sort((a, b) => a.pick - b.pick).map(p => p.playerId);
    const ids = [...new Set(firstRound)].filter(id => byId.has(id));
    for (const p of draftOrder) if (!ids.includes(p.id)) ids.push(p.id);
    return ids.map(id => byId.get(id)!);
  }, [draftOrder, picks, snakeOrder]);

  const rounds = useMemo(() => {
    let max = snakeOrder.length > 0 ? 0 : rosterSize;
    for (const s of snakeOrder) max = Math.max(max, s.round);
    for (const p of picks) max = Math.max(max, p.round);
    return Math.max(max, 1);
  }, [snakeOrder, picks, rosterSize]);

  const cells = useMemo(() => {
    const m = new Map<string, DraftPickEntry>();
    for (const p of picks) m.set(`${p.playerId}:${p.round}`, p);
    return m;
  }, [picks]);

  // Landing fx outlives the queue's `current` (850ms) so the glow can fade for 1.5s.
  const [fxPick, setFxPick] = useState<number | null>(null);
  useEffect(() => {
    if (landingPick == null) return;
    setFxPick(landingPick);
    const t = setTimeout(() => setFxPick(null), FX_MS);
    return () => clearTimeout(t);
  }, [landingPick]);

  return (
    <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border-default bg-surface-raised/40">
      <div
        className="grid min-w-max"
        style={{ gridTemplateColumns: `34px repeat(${columns.length}, minmax(92px, 1fr))` }}
      >
        <div className="sticky top-0 left-0 z-30 bg-surface border-b border-r border-border-default" />
        {columns.map(p => {
          const color = readableOnDark(p.teamColor);
          const sel = selectedTeamId === p.id;
          const left = pointCap - (teamPoints.get(p.id) ?? 0);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectTeam(sel ? null : p.id)}
              aria-pressed={sel}
              title={`${p.teamName} · ${left} pts left`}
              className={cn(
                'sticky top-0 z-20 h-8 px-2 flex items-center justify-center gap-1 border-b-2 text-[11px] font-mono font-bold uppercase tracking-wide',
                'bg-surface transition-colors hover:brightness-125',
                sel && 'ring-1 ring-inset ring-white/20',
              )}
              style={{
                color,
                borderBottomColor: p.teamColor,
                backgroundImage: `linear-gradient(to bottom, transparent, ${p.teamColor}26)`,
              }}
            >
              <span className="truncate min-w-0">{p.teamAbbrev}</span>
              {p.id === userTeamId && <span className="shrink-0 size-1.5 rounded-full bg-neon" aria-label="you" />}
            </button>
          );
        })}

        {Array.from({ length: rounds }, (_, r) => r + 1).map(round => (
          <Row key={round} round={round} columns={columns} cells={cells} selectedTeamId={selectedTeamId}
            currentPick={currentPick} fxPick={fxPick} clockLabel={clockLabel} onOpenPokemon={onOpenPokemon} />
        ))}
      </div>
    </div>
  );
}

function Row({ round, columns, cells, selectedTeamId, currentPick, fxPick, clockLabel, onOpenPokemon }: {
  round: number;
  columns: Player[];
  cells: Map<string, DraftPickEntry>;
  selectedTeamId: string | null;
  currentPick: WarRoomBoardProps['currentPick'];
  fxPick: number | null;
  clockLabel?: string | null;
  onOpenPokemon: (name: string) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 h-[50px] flex items-center justify-center bg-surface border-r border-b border-border-subtle text-[10px] font-mono text-text-muted">
        R{round}
      </div>
      {columns.map(p => {
        const pick = cells.get(`${p.id}:${round}`);
        const onClock = !pick && currentPick?.playerId === p.id && currentPick.round === round;
        const fx = pick != null && pick.overallPick === fxPick;
        const dim = selectedTeamId != null && selectedTeamId !== p.id;
        const base = cn(
          'relative h-[50px] border-b border-border-subtle min-w-0 transition-opacity',
          dim && 'opacity-50',
          selectedTeamId === p.id && 'bg-white/[0.03]',
        );
        if (!pick) {
          return (
            <div key={p.id} className={cn(base, onClock && 'wr-cell-now')}>
              {onClock && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold uppercase tracking-widest text-pink">
                  {clockLabel ?? 'on clock'}
                </span>
              )}
            </div>
          );
        }
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpenPokemon(pick.pokemonName)}
            title={`#${pick.overallPick} ${pick.pokemonName} (${pick.tier}pt)`}
            className={cn(base, 'flex items-center gap-1 pl-1.5 pr-1 text-left hover:brightness-125', fx && 'wr-cell-fx')}
            style={{
              backgroundColor: `${p.teamColor}1f`,
              ['--wr' as never]: p.teamColor,
            }}
          >
            <span className="absolute top-0.5 left-1 text-[8px] font-mono tabular-nums text-text-muted/80 leading-none">
              {pick.overallPick}
            </span>
            <span className={cn('shrink-0 mt-1.5 inline-flex', fx && 'wr-sprite-drop')}>
              <PokemonSprite name={pick.pokemonName} size="sm" />
            </span>
            <span className="min-w-0 mt-1.5 truncate text-[11px] text-text-primary">{pick.pokemonName}</span>
          </button>
        );
      })}
    </>
  );
}
