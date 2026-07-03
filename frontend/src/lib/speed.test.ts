import { test, expect, describe } from 'bun:test';
import { calcSpeed } from '@/lib/speed';

/**
 * Pure-logic coverage for the shared Speed calculator (speed.ts), used by the
 * Matchup Center Speed tab and the Showdown Matchup plugin. Values are locked
 * to what the original inline speed-tab.tsx implementation produced — a change
 * here means the speed ladder is showing wrong numbers.
 *
 * Run: `bun test src/lib/speed.test.ts` from frontend/.
 */

describe('calcSpeed', () => {
  test('base 142 / lvl 100 / 252 EVs / 31 IVs / positive nature, no boosts or items', () => {
    // raw = floor((284 + 31 + 63) + 5) = 383; floor(383 * 1.1) = 421
    expect(calcSpeed(142, 100, 252, 31, 'positive', 0, false, false)).toBe(421);
  });

  test('neutral and negative natures', () => {
    // raw = floor((200 + 31 + 0) + 5) = 236
    expect(calcSpeed(100, 100, 0, 31, 'neutral', 0, false, false)).toBe(236);
    // floor(236 * 0.9) = 212
    expect(calcSpeed(100, 100, 0, 31, 'negative', 0, false, false)).toBe(212);
  });

  test('level scaling (level 50)', () => {
    // raw = floor(378 * 50 / 100 + 5) = 194; floor(194 * 1.1) = 213
    expect(calcSpeed(142, 50, 252, 31, 'positive', 0, false, false)).toBe(213);
  });

  test('Choice Scarf multiplies by 1.5x, floored', () => {
    // floor(421 * 1.5) = 631
    expect(calcSpeed(142, 100, 252, 31, 'positive', 0, true, false)).toBe(631);
  });

  test('Sticky Web applies as a -1 stage', () => {
    // floor(421 * 2 / 3) = 280
    expect(calcSpeed(142, 100, 252, 31, 'positive', 0, false, true)).toBe(280);
    // web cancels a +1 boost back to neutral
    expect(calcSpeed(142, 100, 252, 31, 'positive', 1, false, true)).toBe(421);
  });

  test('positive and negative stat stages', () => {
    // +2: floor(421 * 4 / 2) = 842
    expect(calcSpeed(142, 100, 252, 31, 'positive', 2, false, false)).toBe(842);
    // -2: floor(421 * 2 / 4) = 210
    expect(calcSpeed(142, 100, 252, 31, 'positive', -2, false, false)).toBe(210);
  });

  test('scarf applies after web (stage first, then item)', () => {
    // web: 280, then scarf: floor(280 * 1.5) = 420
    expect(calcSpeed(142, 100, 252, 31, 'positive', 0, true, true)).toBe(420);
  });
});
