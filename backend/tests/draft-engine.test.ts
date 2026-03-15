import { describe, expect, test } from 'bun:test';
import { generateSnakeOrder } from '../src/lib/draft-engine';

describe('generateSnakeOrder', () => {
  test('round 1 follows team order, round 2 reverses, round 3 follows again', () => {
    const order = generateSnakeOrder(['a', 'b', 'c'], 3);
    expect(order.map(p => p.teamId)).toEqual([
      'a', 'b', 'c',
      'c', 'b', 'a',
      'a', 'b', 'c',
    ]);
  });

  test('overallPick increments globally, pick increments within round', () => {
    const order = generateSnakeOrder(['a', 'b'], 2);
    expect(order[0]).toMatchObject({ round: 1, pick: 1, overallPick: 1, teamId: 'a' });
    expect(order[1]).toMatchObject({ round: 1, pick: 2, overallPick: 2, teamId: 'b' });
    expect(order[2]).toMatchObject({ round: 2, pick: 1, overallPick: 3, teamId: 'b' });
    expect(order[3]).toMatchObject({ round: 2, pick: 2, overallPick: 4, teamId: 'a' });
  });

  test('total picks = teams × rounds', () => {
    expect(generateSnakeOrder(['a', 'b', 'c', 'd'], 10)).toHaveLength(40);
  });

  test('zero rounds → empty array', () => {
    expect(generateSnakeOrder(['a', 'b'], 0)).toEqual([]);
  });
});
