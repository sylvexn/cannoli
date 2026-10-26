import { describe, expect, test } from 'bun:test';
import { ReplayParser } from '../src/lib/replay-parser';
import { resolveRosterPokemonName } from '../src/lib/pokedex';

const head = (a: string, b: string) => `|player|p1|A|1
|player|p2|B|1
|poke|p1|${a}, L100|
|poke|p2|${b}, L100|
|switch|p1a: ${a}|${a}, L100|100/100
|switch|p2a: ${b}|${b}, L100|100/100`;

const stats = (log: string, side: 'p1' | 'p2', sp: string) =>
  ReplayParser.parse(log).pokemon.find(p => p.player === side && p.species === sp)!;

describe('indirect KO attribution', () => {
  test('stealth rock KO credits the setter', () => {
    const log = `${head('Toxapex', 'Garchomp')}
|move|p1a: Toxapex|Stealth Rock|p2a: Garchomp
|-sidestart|p2: B|move: Stealth Rock
|switch|p2a: Zapdos|Zapdos, L100|100/100
|-damage|p2a: Zapdos|0 fnt|[from] Stealth Rock
|faint|p2a: Zapdos`;
    const t = stats(log, 'p1', 'Toxapex');
    expect(t.kills).toBe(1);
    expect(t.killCauses).toEqual({ hazard: 1 });
  });

  test('toxic spikes switch-in poison credits the setter on the psn faint', () => {
    const log = `${head('Toxapex', 'Garchomp')}
|move|p1a: Toxapex|Toxic Spikes|p2a: Garchomp
|-sidestart|p2: B|move: Toxic Spikes
|switch|p2a: Zapdos|Zapdos, L100|100/100
|-status|p2a: Zapdos|psn
|-damage|p2a: Zapdos|0 fnt|[from] psn
|faint|p2a: Zapdos`;
    const t = stats(log, 'p1', 'Toxapex');
    expect(t.kills).toBe(1);
    expect(t.killCauses).toEqual({ status: 1 });
  });

  test('baneful bunker poison credits the bunker user', () => {
    const log = `${head('Toxapex', 'Garchomp')}
|move|p1a: Toxapex|Baneful Bunker|p1a: Toxapex
|move|p2a: Garchomp|Earthquake|p1a: Toxapex
|-activate|p1a: Toxapex|move: Protect
|-status|p2a: Garchomp|psn
|-damage|p2a: Garchomp|0 fnt|[from] psn
|faint|p2a: Garchomp`;
    expect(stats(log, 'p1', 'Toxapex').kills).toBe(1);
  });

  test('burn residual credits the inflicter, not the last hitter', () => {
    const log = `${head('Rotom', 'Garchomp')}
|move|p1a: Rotom|Will-O-Wisp|p2a: Garchomp
|-status|p2a: Garchomp|brn
|move|p2a: Garchomp|Earthquake|p1a: Rotom
|-damage|p2a: Garchomp|0 fnt|[from] brn
|faint|p2a: Garchomp`;
    expect(stats(log, 'p1', 'Rotom').kills).toBe(1);
    expect(stats(log, 'p2', 'Garchomp').kills).toBe(0);
  });

  test('charge move (-anim) credits the attacker', () => {
    const log = `${head('Archaludon', 'Garchomp')}
|move|p1a: Archaludon|Electro Shot||[still]
|-anim|p1a: Archaludon|Electro Shot|p2a: Garchomp
|-damage|p2a: Garchomp|0 fnt
|faint|p2a: Garchomp`;
    expect(stats(log, 'p1', 'Archaludon').kills).toBe(1);
  });

  test('destiny bond credits the bonder', () => {
    const log = `${head('Gengar', 'Sceptile')}
|move|p1a: Gengar|Destiny Bond|p1a: Gengar
|-singlemove|p1a: Gengar|Destiny Bond
|move|p2a: Sceptile|Leaf Blade|p1a: Gengar
|-damage|p1a: Gengar|0 fnt
|faint|p1a: Gengar
|-activate|p1a: Gengar|move: Destiny Bond
|faint|p2a: Sceptile`;
    const g = stats(log, 'p1', 'Gengar');
    expect(g.kills).toBe(1);
    expect(g.killCauses).toEqual({ destinybond: 1 });
    expect(stats(log, 'p2', 'Sceptile').kills).toBe(1); // its Leaf Blade still KO'd Gengar
  });
});

describe('cosmetic forme resolution', () => {
  test.each([
    ['Minior-Indigo', 'Minior'], ['Florges-Blue', 'Florges'], ['Furfrou-Star', 'Furfrou'],
    ['Dudunsparce-Three-Segment', 'Dudunsparce'], ['Sinistcha-Masterpiece', 'Sinistcha'],
  ])('%s -> roster %s', (battle, roster) => {
    expect(resolveRosterPokemonName(['Garchomp', roster], battle)).toBe(roster);
  });
  test('real formes stay distinct', () => {
    expect(resolveRosterPokemonName(['Kyurem'], 'Kyurem-Black')).toBe('Kyurem-Black');
  });
});
