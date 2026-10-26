import { test, expect } from 'bun:test';
import { matchSettings, SETTINGS, SECTIONS } from './registry';

test('empty query matches nothing', () => expect(matchSettings('  ')).toEqual([]));
test('trade deadline and fa deadline find the deadline setting', () => {
  expect(matchSettings('trade deadline').map(s => s.id)).toContain('tradeDeadline');
  expect(matchSettings('fa deadline')[0].id).toBe('faDeadlineWeek');
});
test('terms are ANDed and case-insensitive', () => {
  expect(matchSettings('PICK timer')[0].id).toBe('draftTimerEnabled');
  expect(matchSettings('pick zzz')).toEqual([]);
});
test('section label matches', () => expect(matchSettings('tier list').some(s => s.section === 'tiers')).toBe(true));
test('every setting points at a real section', () => {
  for (const s of SETTINGS) expect(SECTIONS.some(x => x.id === s.section)).toBe(true);
});
