import { describe, expect, test } from 'bun:test';
import { DEFAULT_MARKUP } from '@cannoli/rules';
import { getLeagueRuleset, normalizeRuleset, rulesetFromLegacy } from './league-ruleset';
import type { League } from './types';

const league = (extra: object = {}, season: object = {}) =>
  ({ id: 'l', costFormat: 'natdex', season: { pointCap: 100, teraCaptainSlots: 3, rosterSize: 12, ...season }, ...extra }) as unknown as League;

describe('league-ruleset', () => {
  test('legacy fields map onto shared defaults', () => {
    const rs = rulesetFromLegacy(league());
    expect(rs).toMatchObject({ costFormat: 'natdex', pointCap: 100, teraCaptainSlots: 3, rosterSize: 12, megaCap: 1, teraTypesPerCaptain: 3 });
    expect(rs.teraMarkup).toEqual(DEFAULT_MARKUP);
  });
  test('missing league / season falls back to defaults', () => {
    expect(rulesetFromLegacy(null).pointCap).toBe(110);
    expect(rulesetFromLegacy({}).teraCaptainSlots).toBe(2);
  });
  test('wire ruleset wins, string-keyed markup parsed, gaps filled', () => {
    const rs = getLeagueRuleset(league({ ruleset: { pointCap: 90, megaCap: null, teraMarkup: { '9': 11 } } }));
    expect(rs.pointCap).toBe(90);
    expect(rs.megaCap).toBeNull();
    expect(rs.teraMarkup).toEqual({ 9: 11 });
    expect(rs.rosterSize).toBe(12);
  });
  test('result is cached per league object', () => {
    const l = league();
    expect(getLeagueRuleset(l)).toBe(getLeagueRuleset(l));
  });
  test('junk markup falls back to default table', () => {
    expect(normalizeRuleset({ teraMarkup: 'nope' }).teraMarkup).toEqual(DEFAULT_MARKUP);
  });
});
