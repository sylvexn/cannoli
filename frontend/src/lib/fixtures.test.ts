import { describe, expect, it } from 'bun:test';
import { fixtureLabel, fixtureShortLabel, publishTargetWeek } from './constants';
import { isReplayWeekEnded } from '@/pages/replays/replay-types';
import type { ReplayEntry } from '@/pages/replays/replay-types';

const week = (week: number, status: string) => ({ week, status });

describe('publishTargetWeek', () => {
  it('stays on the live week when nothing past it has been played', () => {
    expect(publishTargetWeek([week(11, 'completed'), week(12, 'scheduled')], 11)).toBe(11);
  });

  it('reaches playoff weeks, which sit past a frozen currentWeek', () => {
    // S11 shape: regular season done at week 11, quarterfinals played at 12.
    expect(publishTargetWeek([week(11, 'completed'), week(12, 'completed'), week(13, 'scheduled')], 11)).toBe(12);
  });

  it('counts a disputed match as played', () => {
    expect(publishTargetWeek([week(12, 'disputed')], 11)).toBe(12);
  });

  it('never goes below the live week', () => {
    expect(publishTargetWeek([], 4)).toBe(4);
  });
});

describe('fixture labels', () => {
  it('names playoff rounds instead of printing their week number', () => {
    expect(fixtureLabel({ phase: 'playoffs', playoffRound: 'qf', week: 12 })).toBe('Quarterfinal');
    expect(fixtureShortLabel({ phase: 'playoffs', playoffRound: 'f', week: 14 })).toBe('F');
    expect(fixtureLabel({ phase: 'regular', playoffRound: null, week: 3 })).toBe('Week 3');
    expect(fixtureShortLabel({ phase: 'regular', playoffRound: null, week: 3 })).toBe('W3');
  });
});

describe('isReplayWeekEnded', () => {
  const entry = (over: Partial<ReplayEntry['match']>, phase = 'playoffs'): ReplayEntry => ({
    match: { week: 12, phase, homeScore: null, awayScore: null, ...over } as ReplayEntry['match'],
    league: { season: { currentWeek: 11, archived: false } } as ReplayEntry['league'],
    homeTeam: undefined,
    awayTeam: undefined,
  });

  it('reveals a playoff replay once its result is published', () => {
    expect(isReplayWeekEnded(entry({ homeScore: 4, awayScore: 2 }))).toBe(true);
  });

  it('keeps a still-gated playoff replay hidden', () => {
    expect(isReplayWeekEnded(entry({}))).toBe(false);
  });

  it('still uses the week rule for regular-season replays', () => {
    expect(isReplayWeekEnded(entry({ week: 10 }, 'regular'))).toBe(true);
    expect(isReplayWeekEnded(entry({ week: 11 }, 'regular'))).toBe(false);
  });
});
