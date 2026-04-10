import { describe, expect, test } from 'bun:test';
import {
  computeAdvanceTarget,
  decidePlayoffForfeit,
} from '../src/lib/playoff-advance';

describe('computeAdvanceTarget', () => {
  describe('8-team bracket (qfCount=4)', () => {
    test('qf1 winner → SF1 home slot', () => {
      const t = computeAdvanceTarget({ matchId: 'sapphire-pqf1', playoffRound: 'qf', qfCount: 4 });
      expect(t).toEqual({ nextRound: 'sf', nextMatchOffset: 0, fillHome: true });
    });

    test('qf2 winner → SF1 away slot', () => {
      const t = computeAdvanceTarget({ matchId: 'sapphire-pqf2', playoffRound: 'qf', qfCount: 4 });
      expect(t).toEqual({ nextRound: 'sf', nextMatchOffset: 0, fillHome: false });
    });

    test('qf3 winner → SF2 home slot', () => {
      const t = computeAdvanceTarget({ matchId: 'sapphire-pqf3', playoffRound: 'qf', qfCount: 4 });
      expect(t).toEqual({ nextRound: 'sf', nextMatchOffset: 1, fillHome: true });
    });

    test('qf4 winner → SF2 away slot', () => {
      const t = computeAdvanceTarget({ matchId: 'sapphire-pqf4', playoffRound: 'qf', qfCount: 4 });
      expect(t).toEqual({ nextRound: 'sf', nextMatchOffset: 1, fillHome: false });
    });
  });

  describe('6-team bracket (qfCount=2)', () => {
    test('qf1 winner → SF1 away (1-seed already in home slot)', () => {
      const t = computeAdvanceTarget({ matchId: 'sapphire-pqf1', playoffRound: 'qf', qfCount: 2 });
      expect(t).toEqual({ nextRound: 'sf', nextMatchOffset: 0, fillHome: false });
    });

    test('qf2 winner → SF2 away (2-seed already in home slot)', () => {
      const t = computeAdvanceTarget({ matchId: 'sapphire-pqf2', playoffRound: 'qf', qfCount: 2 });
      expect(t).toEqual({ nextRound: 'sf', nextMatchOffset: 1, fillHome: false });
    });
  });

  describe('semis → finals', () => {
    test('first SF (by id order) → Finals home', () => {
      const t = computeAdvanceTarget({
        matchId: 'sapphire-psf1',
        playoffRound: 'sf',
        qfCount: 4,
        sfMatchIds: ['sapphire-psf1', 'sapphire-psf2'],
      });
      expect(t).toEqual({ nextRound: 'f', nextMatchOffset: 0, fillHome: true });
    });

    test('second SF → Finals away', () => {
      const t = computeAdvanceTarget({
        matchId: 'sapphire-psf2',
        playoffRound: 'sf',
        qfCount: 4,
        sfMatchIds: ['sapphire-psf1', 'sapphire-psf2'],
      });
      expect(t).toEqual({ nextRound: 'f', nextMatchOffset: 0, fillHome: false });
    });
  });

  describe('terminal cases', () => {
    test('finals match has no advance target', () => {
      const t = computeAdvanceTarget({ matchId: 'sapphire-pf1', playoffRound: 'f', qfCount: 4 });
      expect(t).toBeNull();
    });

    test('SF advance with empty sfMatchIds returns null', () => {
      const t = computeAdvanceTarget({
        matchId: 'sapphire-psf1',
        playoffRound: 'sf',
        qfCount: 4,
        sfMatchIds: [],
      });
      expect(t).toBeNull();
    });
  });
});

describe('decidePlayoffForfeit', () => {
  test('home ready / away not ready → away forfeits (ready_asymmetry)', () => {
    expect(decidePlayoffForfeit({ readyHome: true, readyAway: false, homeSeed: 5, awaySeed: 1 }))
      .toEqual({ forfeiter: 'away', reason: 'ready_asymmetry' });
  });

  test('away ready / home not ready → home forfeits (ready_asymmetry)', () => {
    expect(decidePlayoffForfeit({ readyHome: false, readyAway: true, homeSeed: 1, awaySeed: 5 }))
      .toEqual({ forfeiter: 'home', reason: 'ready_asymmetry' });
  });

  test('neither ready → higher seed (lower number) advances', () => {
    expect(decidePlayoffForfeit({ readyHome: false, readyAway: false, homeSeed: 1, awaySeed: 4 }))
      .toEqual({ forfeiter: 'away', reason: 'higher_seed_default' });
    expect(decidePlayoffForfeit({ readyHome: false, readyAway: false, homeSeed: 4, awaySeed: 2 }))
      .toEqual({ forfeiter: 'home', reason: 'higher_seed_default' });
  });

  test('both ready → higher seed default (treats both-ready as both-not-decisive)', () => {
    expect(decidePlayoffForfeit({ readyHome: true, readyAway: true, homeSeed: 1, awaySeed: 4 }))
      .toEqual({ forfeiter: 'away', reason: 'higher_seed_default' });
  });

  test('tied seeds default to away forfeit (home advances)', () => {
    expect(decidePlayoffForfeit({ readyHome: false, readyAway: false, homeSeed: 3, awaySeed: 3 }))
      .toEqual({ forfeiter: 'away', reason: 'higher_seed_default' });
  });

  test('null seeds → infinite (ties → home advances by default)', () => {
    expect(decidePlayoffForfeit({ readyHome: false, readyAway: false, homeSeed: null, awaySeed: null }))
      .toEqual({ forfeiter: 'away', reason: 'higher_seed_default' });
    // Real seed beats null
    expect(decidePlayoffForfeit({ readyHome: false, readyAway: false, homeSeed: null, awaySeed: 4 }))
      .toEqual({ forfeiter: 'home', reason: 'higher_seed_default' });
  });
});
