import { describe, expect, test } from 'bun:test';
import { DEFAULT_RULESET } from '@cannoli/rules';
import { canBeTeraCaptain, getEffectiveCost, getTermCost, getTierList } from './tier-list';

const rs = (over: object) => ({ ...DEFAULT_RULESET, ...over });
const tier9 = getTierList('natdexplus').find(e => e.tier === 9 && !e.teraBanned)!;

describe('tier-list ruleset helpers', () => {
  test('default markup unchanged', () => {
    expect([9, 8, 5, 1, 12].map(t => getTermCost(t))).toEqual([12, 10, 6, 1, 12]);
  });
  test('custom table / tera off', () => {
    expect(getTermCost(9, rs({ teraMarkup: { 9: 20 } }))).toBe(20);
    expect(getTermCost(9, rs({ teraEnabled: false }))).toBe(9);
    expect(getEffectiveCost(tier9.name, true, 'natdexplus', rs({ teraMarkup: { 9: 20 } }))).toBe(20);
  });
  test('captain eligibility derives from the table keys', () => {
    expect(canBeTeraCaptain(tier9.name, 'natdexplus')).toBe(true);
    expect(canBeTeraCaptain(tier9.name, 'natdexplus', rs({ teraMarkup: { 8: 10 } }))).toBe(false);
    expect(canBeTeraCaptain(tier9.name, 'natdexplus', rs({ teraEnabled: false }))).toBe(false);
    expect(canBeTeraCaptain('Nonexistent')).toBe(false);
  });
});
