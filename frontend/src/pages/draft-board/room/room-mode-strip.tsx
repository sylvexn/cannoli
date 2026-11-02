/**
 * RoomModeStrip - thin bar at the very top of the draft room that switches
 * between Live / Rehearsal / Staff dry-run and (dev only) jumps to fixture states.
 *
 * MOUNTING (in draft-board.tsx, once, above lobby and live room):
 *
 *   const { state, dispatch, autoPickCurrent, wsConnected, ... } = useDraftState({ source });
 *   const room = useRoomMode({ state, dispatch });
 *   ...
 *   <RoomModeStrip room={room} onAutoPick={autoPickCurrent} />
 *
 *   - Lobby "Warm up - rehearsal" button:  onRehearse={room.rehearse}
 *   - Fixture page-level flags (dev state jumper):
 *       const wsOk = room.flags.wsConnected ?? wsConnected;            // 'disconnected'
 *       const captainGateOpen = room.flags.captainGateOpen ?? (computed as today); // 'captain-gate'
 *     NOTE the existing captainGateOpen requires source==='server'; keep the
 *     override first so the fixture (simulator source) can open it.
 *   - Nothing else changes: rehearsal/dry-run are just state.source==='simulator'
 *     with state.roomMode set, so the same room renders.
 *
 * Visibility: hazard stripes in rehearsal / dry-run. In Live it collapses to a
 * slim switch row; hidden entirely for coaches while a real draft is running
 * (room.lockedLive) so nobody wanders off mid-draft. Dev keeps the JUMP chips.
 */
import { Pause, Play, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RoomMode } from '../types';
import { FIXTURE_IDS, FIXTURE_LABELS } from './state-fixtures';
import type { RoomClock, RoomModeApi } from './use-room-mode';

export interface RoomModeStripProps {
  room: RoomModeApi;
  /** `autoPickCurrent` from useDraftState; enables the dry-run "auto-pick seat" button. */
  onAutoPick?: () => void;
  className?: string;
}

const HELP: Record<RoomMode, string> = {
  live: 'Live = the real draft.',
  rehearsal: 'Rehearsal = your real league, real order, bot coaches, nothing saved.',
  'dry-run': 'Dry-run = you drive every seat, with staff controls. Nothing saved.',
};

const HAZARD = {
  backgroundImage:
    'repeating-linear-gradient(135deg, rgba(232,121,249,0.07) 0 8px, transparent 8px 16px)',
};

function Seg<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded border border-border-subtle overflow-hidden" role="group">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-6 px-2 text-[10px] font-mono uppercase tracking-widest transition-colors',
            value === o.value
              ? 'bg-pink/15 text-pink'
              : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay/50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const CLOCKS: { value: RoomClock; label: string }[] = [
  { value: '1x', label: '1×' },
  { value: '4x', label: '4×' },
  { value: 'paused', label: 'paused' },
];

export function RoomModeStrip({ room, onAutoPick, className }: RoomModeStripProps) {
  const { mode, setMode, staff, isDev, lockedLive, clock, setClock, jump, fixtureId } = room;
  if (lockedLive && !isDev) return null;

  const live = mode === 'live';
  const modes: { value: RoomMode; label: string }[] = [
    { value: 'live', label: 'Live' },
    { value: 'rehearsal', label: 'Rehearsal' },
    ...(staff ? [{ value: 'dry-run' as const, label: 'Staff dry-run' }] : []),
  ];

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3',
        live ? 'border-border-subtle bg-surface py-0.5' : 'border-pink/40 bg-[#08080d] py-1',
        className,
      )}
      style={live ? undefined : HAZARD}
      data-room-mode={mode}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('text-[10px] font-mono uppercase tracking-[0.2em] shrink-0', live ? 'text-text-muted' : 'text-pink')}>
          Room
        </span>
        {!lockedLive && <Seg value={mode} options={modes} onChange={setMode} />}
        {!live && (
          <span className="hidden md:block truncate text-[10px] font-mono text-text-muted">{HELP[mode]}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 ml-auto">
        {mode === 'dry-run' && onAutoPick && (
          <button
            type="button"
            onClick={onAutoPick}
            className="flex min-h-6 items-center gap-1 rounded border border-pink/40 px-2 text-[10px] font-mono uppercase tracking-widest text-pink hover:bg-pink/10"
            title="Auto-pick for the seat on the clock"
          >
            <Wand2 size={10} /> auto-pick seat
          </button>
        )}

        {!live && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted">Clock</span>
            <Seg value={clock} options={CLOCKS} onChange={setClock} />
            {clock === 'paused' ? <Pause size={10} className="text-pink" /> : <Play size={10} className="text-text-muted" />}
          </div>
        )}

        {isDev && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted">Jump</span>
            {FIXTURE_IDS.map(id => (
              <button
                key={id}
                type="button"
                onClick={() => jump(id)}
                className={cn(
                  'min-h-6 rounded-full border px-2 text-[10px] font-mono transition-colors',
                  fixtureId === id
                    ? 'border-pink bg-pink/15 text-pink'
                    : 'border-border-subtle text-text-muted hover:border-pink/50 hover:text-pink',
                )}
              >
                {FIXTURE_LABELS[id]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
