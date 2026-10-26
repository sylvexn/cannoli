import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_MARKUP, DEFAULT_RULESET, captainEligible, captainHeadroomNeeded, captainMaxTier,
  markupCost, megaLimit, parseMarkup, rosterBand, rosterCost, validateRulesetShape,
} from './index';

const rs = DEFAULT_RULESET;

describe('rules', () => {
  test('markup table matches the legacy hardcoded schedule', () => {
    const legacy: Record<number, number> = { 9: 12, 8: 10, 7: 9, 6: 8, 5: 6, 4: 5, 3: 4, 2: 2, 1: 1 };
    expect({ ...DEFAULT_MARKUP }).toEqual(legacy);
    for (let t = 0; t <= 20; t++) {
      expect(markupCost(rs, t, true)).toBe(legacy[t] ?? t);
      expect(markupCost(rs, t, false)).toBe(t);
    }
  });
  test('tera disabled: no markup, nobody eligible', () => {
    const off = { ...rs, teraEnabled: false };
    expect(markupCost(off, 9, true)).toBe(9);
    expect(captainEligible(off, { tier: 9 })).toBe(false);
  });
  test('eligibility: tier <= 9 and not tera-banned', () => {
    expect(captainEligible(rs, { tier: 9 })).toBe(true);
    expect(captainEligible(rs, { tier: 10 })).toBe(false);
    expect(captainEligible(rs, { tier: 0 })).toBe(false);
    expect(captainEligible(rs, { tier: 5, teraBanned: true })).toBe(false);
    expect(captainMaxTier(rs)).toBe(9);
  });
  test('headroom sums the largest eligible markups', () => {
    const roster = [{ tier: 9 }, { tier: 8 }, { tier: 12 }, { tier: 7, teraBanned: true }, { tier: 1 }];
    expect(captainHeadroomNeeded(rs, roster, 2)).toBe(3 + 2);
    expect(captainHeadroomNeeded(rs, roster, 0)).toBe(0);
    expect(captainHeadroomNeeded(rs, roster)).toBe(5);
  });
  test('rosterCost', () => {
    expect(rosterCost(rs, [{ cost: 9, isCaptain: true }, { cost: 15 }])).toBe(27);
  });
  test('mega + band', () => {
    expect(megaLimit({ megaCap: null })).toBe(Infinity);
    expect(megaLimit({ megaCap: 0 })).toBe(0);
    expect(rosterBand(rs)).toEqual({ min: 10, max: 10 });
    expect(rosterBand({ ...rs, rosterMin: 9, rosterMax: 12 }, { min: 10, max: null })).toEqual({ min: 10, max: 12 });
  });
  test('parseMarkup + shape validation', () => {
    expect(parseMarkup('{"9":12,"x":1}')).toEqual({ 9: 12 });
    expect(parseMarkup('junk')).toEqual({ ...DEFAULT_MARKUP });
    expect(validateRulesetShape(rs)).toEqual([]);
    expect(validateRulesetShape({ ...rs, rosterMin: 11 }).length).toBe(1);
    expect(validateRulesetShape({ ...rs, teraEnabled: false }).length).toBe(1);
  });
});
