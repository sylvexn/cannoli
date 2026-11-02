import { test, expect } from 'bun:test';
import { DEFAULT_RULESET } from '@cannoli/rules';
import { toForm } from '../rulesets/form';
import { buildPayload, changedKeys, fillWeekly, initDraft, slugify } from './logic';
import type { ApiSeasonSetupDefaults } from '@/lib/api';

const defaults: ApiSeasonSetupDefaults = {
  nextSeasonNumber: 12,
  source: { seasonId: 1, seasonNumber: 11 },
  leagues: [{
    sourceLeagueId: 's11-ruby', slug: 'ruby', name: 'Ruby League', color: '#f00',
    ruleset: { ...DEFAULT_RULESET, id: 7, teraMarkup: DEFAULT_RULESET.teraMarkup as Record<string, number> },
    totalWeeks: 9, tradeDeadlineWeek: 5, playoffTeamCount: 4, forfeitPolicy: 'admin_review', format: 'gen9natdex',
    teams: [{ teamName: 'A', teamAbbrev: 'A', teamColor: '#111', coachName: 'c', username: 'Bob' }, { teamName: '', teamAbbrev: '', teamColor: '#111', coachName: '', username: null }],
  }],
};

test('slug + weekly fill', () => {
  expect(slugify('Ruby League')).toBe('ruby');
  expect(fillWeekly('2026-01-06', 3)).toEqual({ '1': '2026-01-06', '2': '2026-01-13', '3': '2026-01-20' });
});

test('changedKeys counts diffs only', () => {
  const f = toForm(DEFAULT_RULESET);
  expect(changedKeys(f, f)).toEqual([]);
  expect(changedKeys({ ...f, pointCap: f.pointCap + 1, megaLimited: false }, f).sort()).toEqual(['megaCap', 'pointCap']);
});

test('payload: copy points at source ruleset, drops incomplete teams, caps deadline', () => {
  const d = initDraft(defaults);
  d.leagues[0].draftDate = '';
  d.tradeDeadlineWeek = 99;
  const p = buildPayload(d, true);
  expect(p.seasonNumber).toBe(12);
  expect(p.tradeDeadlineWeek).toBe(9);
  expect(p.overlapOverride).toBe(true);
  expect(p.weekDates).toBeNull();
  expect(p.leagues[0].sourceRulesetId).toBe(7);
  expect(p.leagues[0].teams).toHaveLength(1);
  expect(p.leagues[0].teams[0].managerUsername).toBe('Bob');
  expect('name' in p.leagues[0].rules).toBe(false);
});
