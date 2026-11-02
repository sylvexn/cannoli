import { test, expect, describe } from 'bun:test';
import type { ApiDraftState } from '@/lib/api';
import { draftReducer, generateSnakeSlots } from './draft-reducer';
import { DEFAULT_FILTERS, type DraftState } from './types';

const teams = ['t1', 't2', 't3'];
const base: DraftState = {
  view: 'active', status: 'configuring', source: 'server',
  allPicks: [], trades: [], snakeOrder: [], currentPickIndex: 0, speed: 1,
  roomMode: 'live', rehearsalSeed: null,
  timerSeconds: 30, timerDuration: 30, timerPaused: false, userTeamId: null,
  viewMode: 'grid', selectedTeamId: null, filters: DEFAULT_FILTERS, detailPokemon: null,
  pointCap: 110, draftQueue: [], autoDraftQueue: false, liveTimerExpiresAt: null,
};
const snake = generateSnakeSlots(teams, 3);
const snap = (over: Partial<ApiDraftState>): ApiDraftState => ({
  leagueId: 'l', status: 'in_progress', currentPickIndex: 0, timerDuration: 45, timerExpiresAt: null,
  picks: [], snakeOrder: snake, teamPoints: {}, ...over,
});

describe('LIVE_SYNC', () => {
  test('paused keeps the board up with the clock frozen', () => {
    const s = draftReducer(base, { type: 'LIVE_SYNC', snapshot: snap({ status: 'paused' }) });
    expect(s.status).toBe('running');
    expect(s.timerPaused).toBe(true);
    expect(s.timerSeconds).toBe(45);
    const resumed = draftReducer(s, { type: 'LIVE_SYNC', snapshot: snap({ status: 'in_progress' }) });
    expect(resumed.timerPaused).toBe(false);
  });

  test('picks slot by pickNumber so a skipped slot stays empty', () => {
    // Slot 1 picked, slot 2 skipped, slot 3 picked (round 1 = t1,t2,t3).
    const s = draftReducer(base, {
      type: 'LIVE_SYNC',
      snapshot: snap({
        currentPickIndex: 3,
        picks: [
          { teamId: 't1', pokemonName: 'A', tier: 5, pickNumber: 1 },
          { teamId: 't3', pokemonName: 'B', tier: 5, pickNumber: 3 },
        ],
      }),
    });
    expect(s.allPicks.map(p => p.overallPick)).toEqual([1, 3]);
    expect(s.allPicks[1]).toMatchObject({ round: 1, pick: 3, playerId: 't3' });
  });
});
