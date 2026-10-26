import { describe, it, expect } from 'vitest';
import type { League } from '@/lib/types';
import { orderLeaguesForUser, sortLeaguesByActivity } from './league-order';

const lg = (id: string, phase: string, archived = false) =>
  ({ id, season: { phase, archived } }) as unknown as League;

describe('league ordering', () => {
  const leagues = [lg('s10', 'offseason', true), lg('a', 'regular'), lg('b', 'draft')];

  it('puts archived seasons last', () => {
    expect(sortLeaguesByActivity(leagues).map(l => l.id)).toEqual(['b', 'a', 's10']);
  });

  it("puts the user's leagues first, active before archived", () => {
    const teams = { s10: [{ userId: 7 }], a: [{ userId: 7 }], b: [{ userId: 1 }] };
    expect(orderLeaguesForUser(leagues, teams, '7').map(l => l.id)).toEqual(['a', 's10', 'b']);
  });

  it('leaves guests unchanged', () => {
    expect(orderLeaguesForUser(leagues, {}, undefined)).toBe(leagues);
  });
});
