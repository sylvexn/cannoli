import { test, expect } from 'bun:test';
import { DEFAULT_RULESET } from '@cannoli/rules';
import { toForm, toInput, setMarkup, markupRows, budgetPreview, prefillLeagueRulesets, rulesetIdsPayload, formErrors } from './form';

test('unlimited mega -> null, 0 stays 0', () => {
  const f = toForm({ ...DEFAULT_RULESET, megaCap: null });
  expect(f.megaLimited).toBe(false);
  expect(toInput(f).megaCap).toBeNull();
  expect(toInput({ ...f, megaLimited: true, megaCap: 0 }).megaCap).toBe(0);
});
test('round trip + band null when off', () => {
  const i = toInput(toForm(DEFAULT_RULESET));
  expect(i.rosterMin).toBeNull();
  expect(i.megaCap).toBe(1);
  expect(i.teraMarkup).toEqual(DEFAULT_RULESET.teraMarkup);
  expect(toInput({ ...toForm(DEFAULT_RULESET), customBand: true, rosterMin: 10, rosterMax: 12 }).rosterMax).toBe(12);
});
test('tera off forces 0 slots and stays valid', () => {
  const f = { ...toForm(DEFAULT_RULESET), teraEnabled: false };
  expect(toInput(f).teraCaptainSlots).toBe(0);
  expect(formErrors(f)).toEqual([]);
});
test('markup edits + preview', () => {
  const f = toForm(DEFAULT_RULESET);
  const m = setMarkup(f.teraMarkup, 9, null);
  expect(m[9]).toBeUndefined();
  expect(setMarkup(m, 5, 7)[5]).toBe(7);
  expect(markupRows({ ...f, teraMarkup: m })[8]).toMatchObject({ tier: 9, eligible: false, delta: 0 });
  expect(markupRows(f)[8]).toMatchObject({ captain: 12, delta: 3 });
  expect(budgetPreview(f).headroom).toBe(5);
});
test('wizard prefill', () => {
  expect(prefillLeagueRulesets(['a', 'b'], 1, { a: 2, z: 3 })).toEqual({ a: 2, b: 1 });
  expect(prefillLeagueRulesets(['a', 'b'], 1, { a: 2 }, true)).toEqual({ a: 1, b: 1 });
  expect(rulesetIdsPayload({ a: 1, b: null }, ['a', 'b'])).toEqual({ a: 1 });
});
