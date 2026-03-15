import { describe, expect, test } from 'bun:test';
import { effectiveCost, TERA_COST_MAP } from '../src/lib/tera-cost';

describe('effectiveCost', () => {
  test('non-captain returns raw tier', () => {
    expect(effectiveCost(9, false)).toBe(9);
    expect(effectiveCost(15, false)).toBe(15);
    expect(effectiveCost(1, false)).toBe(1);
  });

  test('captain at tier 9 → 12, tier 5 → 6 (markup table)', () => {
    expect(effectiveCost(9, true)).toBe(12);
    expect(effectiveCost(8, true)).toBe(10);
    expect(effectiveCost(7, true)).toBe(9);
    expect(effectiveCost(6, true)).toBe(8);
    expect(effectiveCost(5, true)).toBe(6);
    expect(effectiveCost(4, true)).toBe(5);
    expect(effectiveCost(3, true)).toBe(4);
    expect(effectiveCost(2, true)).toBe(2);
    expect(effectiveCost(1, true)).toBe(1);
  });

  test('captain above tier 9 has no markup', () => {
    // CLAUDE.md: captains limited to tier 9 and below — but if backend ever gets a
    // tier-10+ captain through, cost falls back to raw tier (no spurious inflation).
    expect(effectiveCost(10, true)).toBe(10);
    expect(effectiveCost(15, true)).toBe(15);
  });

  test('every entry in TERA_COST_MAP is ≥ its base tier', () => {
    for (const [tierStr, captainCost] of Object.entries(TERA_COST_MAP)) {
      const tier = Number(tierStr);
      expect(captainCost).toBeGreaterThanOrEqual(tier);
    }
  });
});
