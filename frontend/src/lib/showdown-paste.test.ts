import { test, expect, describe } from 'bun:test';
import { parseShowdownPaste } from '@/lib/showdown-paste';

/**
 * Coverage for the shared Showdown/PokePaste export parser (showdown-paste.ts),
 * used by the Matchup Center custom team builder and the Showdown Matchup
 * plugin. It extracts species names from a pasted team export, ignoring set
 * detail lines (moves, Ability/EVs/IVs/Nature/Tera/etc.).
 *
 * Run: `bun test src/lib/showdown-paste.test.ts` from frontend/.
 */

const REALISTIC_PASTE = `Great Tusk @ Heavy-Duty Boots
Ability: Protosynthesis
Tera Type: Steel
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Headlong Rush
- Knock Off
- Rapid Spin
- Ice Spinner

Pult (Dragapult) (M) @ Choice Specs
Ability: Infiltrator
Level: 100
Shiny: Yes
Tera Type: Ghost
EVs: 252 SpA / 4 SpD / 252 Spe
IVs: 0 Atk
Timid Nature
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn

Hatterene (F) @ Leftovers
Ability: Magic Bounce
Happiness: 160
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Psychic
- Draining Kiss
- Calm Mind
- Nuzzle

Ting-Lu
Ability: Vessel of Ruin
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Spikes
- Ruination
- Earthquake
- Whirlwind`;

describe('parseShowdownPaste', () => {
  test('extracts species from a realistic multi-mon paste', () => {
    expect(parseShowdownPaste(REALISTIC_PASTE)).toEqual([
      'Great Tusk',
      'Dragapult',
      'Hatterene',
      'Ting-Lu',
    ]);
  });

  test('extracts species from "Nickname (Species)" with no item', () => {
    expect(parseShowdownPaste('Bob (Kingambit)')).toEqual(['Kingambit']);
  });

  test('strips item and gender markers', () => {
    expect(parseShowdownPaste('Garchomp (M) @ Rocky Helmet')).toEqual(['Garchomp']);
    expect(parseShowdownPaste('Nickname (Weavile) (F) @ Heavy-Duty Boots')).toEqual(['Weavile']);
  });

  test('ignores blank lines and set detail lines', () => {
    const text = `\nAbility: Levitate\nEVs: 252 Spe\nIVs: 0 Atk\nLevel: 50\nShiny: Yes\nTera Type: Fairy\nHappiness: 255\nModest Nature\n- Sludge Bomb\nRotom-Wash @ Leftovers\n`;
    expect(parseShowdownPaste(text)).toEqual(['Rotom-Wash']);
  });

  test('keeps Type: Null as a species despite the colon', () => {
    expect(parseShowdownPaste('Type: Null @ Eviolite')).toEqual(['Type: Null']);
    expect(parseShowdownPaste('Type: Null')).toEqual(['Type: Null']);
    expect(parseShowdownPaste('Nully (Type: Null) @ Eviolite')).toEqual(['Type: Null']);
  });

  test('Type: Null set with detail lines only yields the species', () => {
    const text = `Type: Null @ Eviolite\nAbility: Battle Armor\nTera Type: Normal\nEVs: 252 HP / 4 Atk / 252 SpD\nCareful Nature\n- Swords Dance\n- Crush Claw`;
    expect(parseShowdownPaste(text)).toEqual(['Type: Null']);
  });

  test('still skips Gigantamax/Dynamax Level detail lines and folder headers', () => {
    const text = `=== [gen9] Folder/My Team ===\nGigantamax: Yes\nDynamax Level: 10\nUrshifu-Rapid-Strike @ Choice Band`;
    expect(parseShowdownPaste(text)).toEqual(['Urshifu-Rapid-Strike']);
  });
});
