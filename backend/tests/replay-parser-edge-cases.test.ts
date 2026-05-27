/**
 * Edge cases for K/D attribution in ReplayParser.
 *
 * These tests build minimal synthetic Pokemon Showdown protocol streams to
 * exercise the trickier branches of `handleDamage`:
 *  - the `[from]` self-damage branch (item:/ability:/Recoil/confusion)
 *  - hazard attribution via `hazardSetters`
 *  - residual move damage (Future Sight) via `[of]`
 *  - end-of-turn status damage credited to `lastAttacker`
 *  - parser limitations around damage-less faints (Perish Song)
 *
 * Run: bun test backend/tests/replay-parser-edge-cases.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { ReplayParser } from '../src/lib/replay-parser';

function feed(parser: ReplayParser, lines: string[]): void {
  for (const line of lines) parser.feedLine(line);
}

describe('ReplayParser — K/D edge cases', () => {
  // ──────────────────────────────────────────────────────────────────────
  // 1. Belly Drum suicide
  //
  // p1's Linoone uses Belly Drum at 50% HP, faints from the HP cost. No
  // opponent struck it — the only damage line is `[from] move: Belly Drum`
  // tagged on itself. PS actually emits this kind of self-damage with a
  // fromTag like `move: Belly Drum` or no fromTag at all on the user. We use
  // a generic self-damage line; either way no opposing Pokemon should be
  // credited with a kill.
  // ──────────────────────────────────────────────────────────────────────
  test('Belly Drum self-faint awards no kill credit', () => {
    const parser = new ReplayParser();
    feed(parser, [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|poke|p1|Linoone, M|',
      '|poke|p2|Snorlax, M|',
      '|teampreview',
      '|start',
      '|switch|p1a: Roone|Linoone, M|100/100',
      '|switch|p2a: Lax|Snorlax, M|100/100',
      '|turn|1',
      '|move|p1a: Roone|Belly Drum|p1a: Roone',
      // Self-damage from Belly Drum brings Linoone to 0. No [of] tag — it's
      // a self-targeting move, so lastAttacker(Roone) is Roone itself (same
      // side), which the faint handler must reject (killerSide === side).
      '|-damage|p1a: Roone|0 fnt|[from] move: Belly Drum',
      '|faint|p1a: Roone',
    ]);

    const result = parser.getResult();
    const linoone = result.pokemon.find(p => p.species === 'Linoone');
    const snorlax = result.pokemon.find(p => p.species === 'Snorlax');

    expect(linoone?.deaths).toBe(1);
    expect(linoone?.kills).toBe(0);
    expect(snorlax?.kills).toBe(0);
    expect(snorlax?.deaths).toBe(0);

    const totalKills = result.pokemon.reduce((s, p) => s + p.kills, 0);
    expect(totalKills).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. Future Sight delayed KO
  //
  // p1's Slowking-Galar uses Future Sight on turn 1; switches to Tyranitar.
  // Two turns later the move lands on p2's Pelipper for a KO. The damage
  // line carries `[from] move: Future Sight|[of] p1a: Slowking-Galar` even
  // though Slowking is no longer the active Pokemon. The `[of]` branch in
  // handleDamage credits the original caster.
  // ──────────────────────────────────────────────────────────────────────
  test('Future Sight credits the original caster via [of]', () => {
    const parser = new ReplayParser();
    feed(parser, [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|poke|p1|Slowking-Galar, M|',
      '|poke|p1|Tyranitar, M|',
      '|poke|p2|Pelipper, M|',
      '|teampreview',
      '|start',
      '|switch|p1a: Slow|Slowking-Galar, M|100/100',
      '|switch|p2a: Peli|Pelipper, M|50/100',
      '|turn|1',
      '|move|p1a: Slow|Future Sight|p2a: Peli',
      '|turn|2',
      '|switch|p1a: Tar|Tyranitar, M|100/100',
      '|turn|3',
      // Future Sight resolves; Pelipper faints. Note the [of] still points at
      // Slowking-Galar (the original caster), even though it's off the field.
      '|-damage|p2a: Peli|0 fnt|[from] move: Future Sight|[of] p1a: Slow',
      '|faint|p2a: Peli',
    ]);

    const result = parser.getResult();
    const slowking = result.pokemon.find(p => p.species === 'Slowking-Galar');
    const tyranitar = result.pokemon.find(p => p.species === 'Tyranitar');
    const pelipper = result.pokemon.find(p => p.species === 'Pelipper');

    expect(pelipper?.deaths).toBe(1);
    expect(slowking?.kills).toBe(1);
    expect(tyranitar?.kills).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. Perish Song KO — DOCUMENTED PARSER GAP
  //
  // PS emits `|-end|p2a: Foo|perish0` followed directly by `|faint|p2a: Foo`
  // with NO intervening `|-damage|` line. Our parser only stages a killer
  // from |-damage|, and the faint handler falls back to lastAttacker(target)
  // — which for a Perish-trapped sweep is usually empty or stale. So the
  // current behaviour is "no kill credit awarded". Fixing this would require
  // tracking Perish Song casters via |-singleturn| / |-start| lines, which
  // is out of scope here.
  //
  // We assert the current behaviour rather than the desired one, with a TODO
  // so the gap is visible in test output.
  // ──────────────────────────────────────────────────────────────────────
  test('Perish Song faint produces no kill credit (documented limitation)', () => {
    // TODO: Parser cannot attribute Perish Song KOs because PS emits no
    // |-damage| line for the perish faint. To fix, track perish-song casters
    // from |-start|...|perish3 lines and credit on |faint| when |-end|...|perish0
    // immediately precedes. See replay-parser.ts handleDamage / handleFaint.
    const parser = new ReplayParser();
    feed(parser, [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|poke|p1|Politoed, M|',
      '|poke|p2|Gengar, M|',
      '|teampreview',
      '|start',
      '|switch|p1a: Toed|Politoed, M|100/100',
      '|switch|p2a: Gar|Gengar, M|10/100',
      '|turn|1',
      '|move|p1a: Toed|Perish Song|p1a: Toed',
      '|-start|p1a: Toed|perish3',
      '|-start|p2a: Gar|perish3',
      '|turn|2',
      '|-start|p1a: Toed|perish2',
      '|-start|p2a: Gar|perish2',
      '|turn|3',
      '|-start|p1a: Toed|perish1',
      '|-start|p2a: Gar|perish1',
      '|turn|4',
      '|-end|p2a: Gar|perish0',
      // No |-damage| line — straight to faint.
      '|faint|p2a: Gar',
    ]);

    const result = parser.getResult();
    const politoed = result.pokemon.find(p => p.species === 'Politoed');
    const gengar = result.pokemon.find(p => p.species === 'Gengar');

    expect(gengar?.deaths).toBe(1);
    // Gap: ideally Politoed would be credited, but the parser cannot tell.
    expect(politoed?.kills).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. End-of-turn double-faint (poison/poison)
  //
  // p1's Gliscor toxics p2's Heatran; p2's Heatran (already toxic'd) lays
  // a toxic on Gliscor too via Toxic. Both are on 1 HP at turn end and both
  // tick down to 0. Each |-damage|...|[from] tox line fires; the parser
  // credits whoever last attacked the target (the toxin source). We expect
  // 1 kill on each side.
  // ──────────────────────────────────────────────────────────────────────
  test('mutual end-of-turn poison KOs credit each toxin setter', () => {
    const parser = new ReplayParser();
    feed(parser, [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|poke|p1|Gliscor, M|',
      '|poke|p2|Heatran, M|',
      '|teampreview',
      '|start',
      '|switch|p1a: Glis|Gliscor, M|100/100',
      '|switch|p2a: Tran|Heatran, M|100/100',
      '|turn|1',
      // Gliscor toxics Heatran first.
      '|move|p1a: Glis|Toxic|p2a: Tran',
      '|-status|p2a: Tran|tox',
      // Heatran toxics Gliscor back (Gliscor is Poison Heal in canon, but
      // for this test we let it actually take poison damage).
      '|move|p2a: Tran|Toxic|p1a: Glis',
      '|-status|p1a: Glis|tox',
      '|turn|2',
      // Both tick down to 0 simultaneously at end of turn.
      '|-damage|p1a: Glis|0 fnt|[from] psn',
      '|faint|p1a: Glis',
      '|-damage|p2a: Tran|0 fnt|[from] psn',
      '|faint|p2a: Tran',
    ]);

    const result = parser.getResult();
    const gliscor = result.pokemon.find(p => p.species === 'Gliscor');
    const heatran = result.pokemon.find(p => p.species === 'Heatran');

    expect(gliscor?.deaths).toBe(1);
    expect(heatran?.deaths).toBe(1);
    // Each toxin caster gets credit via lastAttacker on the [from] psn branch.
    expect(gliscor?.kills).toBe(1);
    expect(heatran?.kills).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. Recoil-only faint after exchange
  //
  // p2's Talonflame uses Brave Bird and KOs p1's Tangrowth. Earlier this
  // turn Tangrowth attacked Talonflame with Giga Drain — so
  // lastAttacker.get('p2a: Talon') === 'p1a: Tang' at the time of the
  // recoil tick. The handleDamage Recoil branch correctly sets
  // killerNick = null. handleFaint now distinguishes "no entry"
  // from "explicit null decision" via pendingKiller.has(), so the
  // posthumous lastAttacker fallback is correctly skipped.
  // ──────────────────────────────────────────────────────────────────────
  test('Recoil faint after KOing target does not credit the dead target', () => {
    const parser = new ReplayParser();
    feed(parser, [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|poke|p1|Tangrowth, M|',
      '|poke|p2|Talonflame, M|',
      '|teampreview',
      '|start',
      '|switch|p1a: Tang|Tangrowth, M|100/100',
      '|switch|p2a: Talon|Talonflame, M|30/100',
      '|turn|1',
      // Tangrowth hits Talonflame first — sets lastAttacker(Talon) = Tang.
      '|move|p1a: Tang|Giga Drain|p2a: Talon',
      '|-damage|p2a: Talon|10/100',
      // Talonflame Brave Birds Tangrowth for the KO.
      '|move|p2a: Talon|Brave Bird|p1a: Tang',
      '|-damage|p1a: Tang|0 fnt',
      '|faint|p1a: Tang',
      // Brave Bird recoil now KOes Talonflame. Without the Recoil branch,
      // killerNick falls through to lastAttacker(Talon) = Tang (dead) and
      // Tang would be credited posthumously.
      '|-damage|p2a: Talon|0 fnt|[from] Recoil',
      '|faint|p2a: Talon',
    ]);

    const result = parser.getResult();
    const tang = result.pokemon.find(p => p.species === 'Tangrowth');
    const talon = result.pokemon.find(p => p.species === 'Talonflame');

    expect(tang?.deaths).toBe(1);
    expect(talon?.deaths).toBe(1);
    expect(talon?.kills).toBe(1); // Brave Bird KO on Tangrowth
    expect(tang?.kills).toBe(0); // No posthumous recoil credit

    // Sanity: total kills = 1, total deaths = 2 (recoil suicide accounts for
    // the imbalance — that's expected and intentional).
    const totalKills = result.pokemon.reduce((s, p) => s + p.kills, 0);
    const totalDeaths = result.pokemon.reduce((s, p) => s + p.deaths, 0);
    expect(totalKills).toBe(1);
    expect(totalDeaths).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5b. Recoil with NO prior attacker — proves the handleDamage fix works
  //
  // Same as test 5 but the recoiler was never attacked by the target before
  // recoil tick. Without the `Recoil` no-credit branch, the catch-all
  // would still try to credit lastAttacker(target), which is unset → null.
  // We can still detect the fix here: if Recoil were misrouted into a
  // self-credit branch (or similar), the recoiler would credit itself.
  //
  // The realistic check here is: a clean recoil suicide produces zero
  // kills total. This catches a regression where the handleDamage fromTag
  // chain accidentally credits the recoiler or the target.
  // ──────────────────────────────────────────────────────────────────────
  test('Recoil suicide with no prior attacker awards no kill', () => {
    const parser = new ReplayParser();
    feed(parser, [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|poke|p1|Rampardos, M|',
      '|poke|p2|Snorlax, M|',
      '|teampreview',
      '|start',
      '|switch|p1a: Ramp|Rampardos, M|10/100',
      '|switch|p2a: Lax|Snorlax, M|100/100',
      '|turn|1',
      // Rampardos uses Head Smash, doesn't KO Snorlax, then dies to recoil.
      '|move|p1a: Ramp|Head Smash|p2a: Lax',
      '|-damage|p2a: Lax|60/100',
      '|-damage|p1a: Ramp|0 fnt|[from] Recoil',
      '|faint|p1a: Ramp',
    ]);

    const result = parser.getResult();
    const ramp = result.pokemon.find(p => p.species === 'Rampardos');
    const lax = result.pokemon.find(p => p.species === 'Snorlax');

    expect(ramp?.deaths).toBe(1);
    expect(ramp?.kills).toBe(0);
    expect(lax?.kills).toBe(0); // No prior attack on Rampardos to fall back to
    expect(lax?.deaths).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6. Hazard chip on switch-in (setter already fainted)
  //
  // p2's Landorus-Therian sets Stealth Rock on p1's side. Lando-T then
  // faints to a different attack. Later, p1's near-dead Volcarona switches
  // in and the Stealth Rock damage KOs it. The hazard setter (Lando-T,
  // even though dead) gets the kill via the `hazardSetters` map.
  //
  // Note: |-sidestart| credits the active Pokemon on the OPPOSITE side of
  // where the hazard lands. So p2's Lando-T (active when SR was set) is
  // recorded as the setter for p1's side hazards.
  // ──────────────────────────────────────────────────────────────────────
  test('Stealth Rock credits original setter even after setter faints', () => {
    const parser = new ReplayParser();
    feed(parser, [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|poke|p1|Garchomp, M|',
      '|poke|p1|Volcarona, M|',
      '|poke|p2|Landorus-Therian, M|',
      '|poke|p2|Tyranitar, M|',
      '|teampreview',
      '|start',
      '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Lando|Landorus-Therian, M|100/100',
      '|turn|1',
      // Lando-T sets SR on p1's side. handleSideStart records:
      //   hazardSetters['p1']['Stealth Rock'] = 'p2a: Lando'
      '|move|p2a: Lando|Stealth Rock|p1a: Chomp',
      '|-sidestart|p1: Alice|move: Stealth Rock',
      // Garchomp KOs Lando.
      '|move|p1a: Chomp|Earthquake|p2a: Lando',
      '|-damage|p2a: Lando|0 fnt',
      '|faint|p2a: Lando',
      '|switch|p2a: Tar|Tyranitar, M|100/100',
      '|turn|2',
      // Garchomp dies to a Stone Edge or whatever — not relevant.
      '|move|p2a: Tar|Stone Edge|p1a: Chomp',
      '|-damage|p1a: Chomp|0 fnt',
      '|faint|p1a: Chomp',
      // Volcarona switches into Stealth Rock and faints from chip. The
      // hazard branch consults hazardSetters['p1']['Stealth Rock'] = Lando.
      '|switch|p1a: Volc|Volcarona, M|13/100',
      '|-damage|p1a: Volc|0 fnt|[from] Stealth Rock',
      '|faint|p1a: Volc',
    ]);

    const result = parser.getResult();
    const lando = result.pokemon.find(p => p.species === 'Landorus-Therian');
    const ttar = result.pokemon.find(p => p.species === 'Tyranitar');
    const volc = result.pokemon.find(p => p.species === 'Volcarona');
    const chomp = result.pokemon.find(p => p.species === 'Garchomp');

    expect(volc?.deaths).toBe(1);
    expect(lando?.deaths).toBe(1);
    expect(chomp?.deaths).toBe(1);

    // Lando set the SR — gets posthumous hazard kill on Volcarona.
    expect(lando?.kills).toBe(1);
    // Tyranitar got Garchomp.
    expect(ttar?.kills).toBe(1);
  });
});
