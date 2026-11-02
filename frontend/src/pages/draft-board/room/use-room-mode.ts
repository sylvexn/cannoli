import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { getLeagueRuleset } from '@/lib/league-ruleset';
import { DEFAULT_FORMAT } from '@/data/tier-list';
import { generateSnakeSlots } from '../draft-reducer';
import type { DraftAction, DraftState, RoomMode } from '../types';
import {
  buildFixture, isFixtureId, type FixtureFlags, type FixtureId,
} from './state-fixtures';

export type RoomClock = '1x' | '4x' | 'paused';

export interface UseRoomModeOptions {
  /** `state` / `dispatch` straight from `useDraftState`. */
  state: DraftState;
  dispatch: Dispatch<DraftAction>;
}

/** Deterministic Fisher-Yates (mulberry32) so a rehearsal's fallback order is stable per league. */
function shuffled<T>(items: T[], seedStr: string): T[] {
  let h = 2166136261;
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Room mode controller. Mode switching is IN-PAGE: the same DraftBoardPage
 * stays mounted and the reducer flips `source` between 'server' (live) and
 * 'simulator' (rehearsal / dry-run), seeded with the real league. No route
 * change, so the room looks identical apart from the strip.
 *
 * Nothing in the simulator path talks to the server: the WS is only enabled
 * for source==='server', and the only API calls in the draft room (start
 * draft, force/skip/undo overrides) are gated on server source or redirected
 * to the reducer by the `simulator` prop of DraftAdminOverrides.
 */
export function useRoomMode({ state, dispatch }: UseRoomModeOptions) {
  const { user } = useAuth();
  const league = useLeague();
  const { players, standings } = useLeagueData();
  const rules = getLeagueRuleset(league);
  const [params, setParams] = useSearchParams();

  const staff = user?.role === 'dev' || user?.role === 'admin' || user?.role === 'bot';
  const isDev = user?.role === 'dev';

  const [fixtureId, setFixtureId] = useState<FixtureId | null>(null);
  const [flags, setFlags] = useState<FixtureFlags>({});

  // Remember the real draft order whenever the server tells us one.
  const realOrderRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (state.source !== 'server' || state.snakeOrder.length === 0) return;
    realOrderRef.current = state.snakeOrder.filter(s => s.round === 1).map(s => s.teamId);
  }, [state.source, state.snakeOrder]);

  /** Round-1 team order: the real one if known, else a shuffle of the league's teams. */
  const teamIds = useMemo(() => {
    const ids = (standings.length ? standings : players).map(p => p.id);
    const real = realOrderRef.current;
    if (real && real.length === ids.length && real.every(id => ids.includes(id))) return real;
    return shuffled(ids, league.id);
    // realOrderRef is intentionally read at call time; state.snakeOrder keeps it fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standings, players, league.id, state.snakeOrder]);

  /** The viewer's real seat; staff without a team sit in seat 1. */
  const userTeamId = useMemo(() => {
    const mine = players.find(p => p.userId != null && user && String(p.userId) === String(user.id));
    return mine?.id ?? state.userTeamId ?? teamIds[0] ?? null;
  }, [players, user, state.userTeamId, teamIds]);

  const common = useCallback(() => {
    if (!userTeamId || teamIds.length === 0) return null;
    return {
      teamIds, userTeamId,
      rounds: rules.rosterSize,
      pointCap: rules.pointCap,
      timerDuration: state.timerDuration || 30,
      rules,
      format: league.costFormat ?? DEFAULT_FORMAT,
      teraCaptainSlots: rules.teraEnabled ? rules.teraCaptainSlots : 0,
    };
  }, [teamIds, userTeamId, rules, state.timerDuration, league.costFormat]);

  const setMode = useCallback((mode: RoomMode) => {
    setFixtureId(null);
    setFlags({});
    if (mode === 'live') {
      if (state.roomMode !== 'live') dispatch({ type: 'EXIT_ROOM' });
      return;
    }
    if (mode === 'dry-run' && !staff) return;
    const c = common();
    if (!c) { toast.error('League teams are still loading'); return; }
    dispatch({
      type: 'START_ROOM', mode,
      seed: {
        snakeOrder: generateSnakeSlots(c.teamIds, c.rounds),
        userTeamId: c.userTeamId,
        timerDuration: c.timerDuration,
        pointCap: c.pointCap,
      },
    });
  }, [state.roomMode, staff, common, dispatch]);

  /** Dev state jumper. Leaves live mode (forces simulator source). */
  const jump = useCallback((id: FixtureId) => {
    if (!isDev) return;
    const c = common();
    if (!c) return;
    const f = buildFixture(id, c);
    dispatch({ type: 'HYDRATE_FIXTURE', mode: 'rehearsal', patch: f.patch });
    setFixtureId(id);
    setFlags(f.flags);
  }, [isDev, common, dispatch]);

  // ?state=<id> (dev only): apply once teams are loaded, then drop the param
  // so a refresh / mode switch doesn't re-trigger it.
  const wanted = params.get('state');
  useEffect(() => {
    if (!wanted || !isDev || !isFixtureId(wanted) || !common()) return;
    jump(wanted);
    const next = new URLSearchParams(params);
    next.delete('state');
    setParams(next, { replace: true });
  }, [wanted, isDev, common, jump, params, setParams]);

  const clock: RoomClock = state.timerPaused ? 'paused' : state.speed === 4 ? '4x' : '1x';
  const setClock = useCallback((c: RoomClock) => {
    if (c === 'paused') { dispatch({ type: 'PAUSE_TIMER' }); return; }
    dispatch({ type: 'SET_SPEED', speed: c === '4x' ? 4 : 1 });
    dispatch({ type: 'RESUME_TIMER' });
  }, [dispatch]);

  return {
    mode: state.roomMode,
    setMode,
    /** Pass as the lobby's `onRehearse`. */
    rehearse: useCallback(() => setMode('rehearsal'), [setMode]),
    staff,
    isDev,
    /** Coaches can't wander off a running real draft. */
    lockedLive: !staff && state.roomMode === 'live' && state.source === 'server' && state.status === 'running',
    clock,
    setClock,
    jump,
    fixtureId,
    /** Page-level overrides from the active fixture (see FixtureFlags). */
    flags,
  };
}

export type RoomModeApi = ReturnType<typeof useRoomMode>;
