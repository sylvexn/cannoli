import { test, expect, describe } from 'bun:test';
import { DEFAULT_RULESET } from '@cannoli/rules';
import { buildFixture, FIXTURE_IDS, type FixtureInput } from './state-fixtures';

const inp: FixtureInput = {
  teamIds: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'],
  userTeamId: 't3',
  rounds: DEFAULT_RULESET.rosterSize,
  pointCap: DEFAULT_RULESET.pointCap,
  timerDuration: 30,
  rules: DEFAULT_RULESET,
  teraCaptainSlots: DEFAULT_RULESET.teraCaptainSlots,
};
const total = inp.teamIds.length * inp.rounds;

describe('state fixtures', () => {
  for (const id of FIXTURE_IDS) {
    test(`${id} is internally consistent`, () => {
      const { patch } = buildFixture(id, inp);
      const picks = patch.allPicks!;
      expect(picks.length).toBe(patch.currentPickIndex!);
      expect(patch.snakeOrder!.length).toBe(total);
      picks.forEach((p, i) => {
        expect(p.overallPick).toBe(i + 1);
        expect(p.playerId).toBe(patch.snakeOrder![i].teamId);
      });
      expect(new Set(picks.map(p => p.pokemonName)).size).toBe(picks.length);
      const pts = new Map<string, number>();
      for (const p of picks) pts.set(p.playerId, (pts.get(p.playerId) ?? 0) + p.tier);
      for (const v of pts.values()) expect(v).toBeLessThanOrEqual(inp.pointCap);
    });
  }

  test('my-turn puts the user on the clock; spectating does not', () => {
    for (const id of ['my-turn', 'my-turn-critical'] as const) {
      const { patch } = buildFixture(id, inp);
      expect(patch.snakeOrder![patch.currentPickIndex!].teamId).toBe('t3');
    }
    const s = buildFixture('spectating', inp).patch;
    expect(s.snakeOrder![s.currentPickIndex!].teamId).not.toBe('t3');
  });

  test('critical timer, last pick, gate, complete', () => {
    expect(buildFixture('my-turn-critical', inp).patch.timerSeconds).toBe(8);
    expect(buildFixture('last-pick', inp).patch.currentPickIndex).toBe(total - 1);
    expect(buildFixture('last-pick', inp).patch.status).toBe('running');
    const gate = buildFixture('captain-gate', inp);
    expect(gate.patch.status).toBe('complete');
    expect(gate.flags.captainGateOpen).toBe(true);
    expect(buildFixture('complete', inp).patch.currentPickIndex).toBe(total);
    expect(buildFixture('disconnected', inp).flags.wsConnected).toBe(false);
    expect(buildFixture('lobby', inp).patch.status).toBe('configuring');
  });

  test('deterministic', () => {
    expect(buildFixture('last-pick', inp)).toEqual(buildFixture('last-pick', inp));
  });
});
