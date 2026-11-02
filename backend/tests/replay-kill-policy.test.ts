/**
 * Kill-attribution league rulings (2026-11, plan/stats-audit-2026-11.md).
 * Log shapes are lifted from real S11 replays (match ids in each test name).
 */
import { describe, expect, test } from 'bun:test';
import { ReplayParser } from '../src/lib/replay-parser';

const run = (lines: string[]) => ReplayParser.parse(['|player|p1|A|', '|player|p2|B|', ...lines].join('\n'));
const k = (r: ReturnType<typeof run>, side: 'p1' | 'p2', species: string) =>
  r.pokemon.find(p => p.player === side && p.species === species)?.kills ?? 0;

describe('self-inflicted faints → last opponent that hit it this stint', () => {
  test('Life Orb death credits the opponent that damaged it this stint', () => {
    const r = run([
      '|switch|p1a: Gren|Greninja, M|100/100',
      '|switch|p2a: Tauros|Tauros-Paldea-Blaze, M|100/100',
      '|move|p2a: Tauros|Raging Bull|p1a: Gren',
      '|-damage|p1a: Gren|5/100',
      '|move|p1a: Gren|Hydro Pump|p2a: Tauros',
      '|-damage|p2a: Tauros|40/100',
      '|-damage|p1a: Gren|0 fnt|[from] item: Life Orb',
      '|faint|p1a: Gren',
    ]);
    expect(k(r, 'p2', 'Tauros-Paldea-Blaze')).toBe(1);
  });

  test('hit from a PREVIOUS stint does not count (s11-emerald-w10m56 shape)', () => {
    const r = run([
      '|switch|p1a: Gren|Greninja, M|100/100',
      '|switch|p2a: Tauros|Tauros-Paldea-Blaze, M|100/100',
      '|move|p2a: Tauros|Raging Bull|p1a: Gren',
      '|-damage|p1a: Gren|30/100',
      '|switch|p1a: Pex|Toxapex, F|100/100',
      '|switch|p1a: Gren|Greninja, M|30/100',
      '|move|p1a: Gren|Hydro Pump|p2a: Tauros',
      '|-damage|p2a: Tauros|40/100',
      '|-damage|p1a: Gren|0 fnt|[from] item: Life Orb',
      '|faint|p1a: Gren',
    ]);
    expect(k(r, 'p2', 'Tauros-Paldea-Blaze')).toBe(0);
  });

  test('lowercase Struggle recoil follows the same rule (s11-sapphire-w8m43)', () => {
    const r = run([
      '|switch|p1a: Blissey|Blissey, F|10/100',
      '|switch|p2a: Corv|Corviknight, F|100/100',
      '|move|p1a: Blissey|Struggle|p2a: Corv',
      '|-damage|p2a: Corv|99/100',
      '|-damage|p1a: Blissey|0 fnt|[from] recoil',
      '|faint|p1a: Blissey',
    ]);
    expect(k(r, 'p2', 'Corviknight')).toBe(0); // Corv never hit Blissey
  });

  test('confusion self-hit credits the opponent that hit it this stint', () => {
    const r = run([
      '|switch|p1a: Bax|Baxcalibur, M|100/100',
      '|switch|p2a: Pult|Dragapult, M|100/100',
      '|move|p2a: Pult|Dragon Darts|p1a: Bax',
      '|-damage|p1a: Bax|10/100',
      '|-activate|p1a: Bax|confusion',
      '|-damage|p1a: Bax|0 fnt|[from] confusion',
      '|faint|p1a: Bax',
    ]);
    expect(k(r, 'p2', 'Dragapult')).toBe(1);
  });
});

describe('sacrifice moves → opposing active mon', () => {
  test('Explosion credits the active target, not a stale earlier attacker (s11-emerald-w4m20)', () => {
    const r = run([
      '|switch|p1a: Meta|Metagross|100/100',
      '|switch|p2a: Bro|Slowbro, M|100/100',
      '|move|p2a: Bro|Scald|p1a: Meta',
      '|-damage|p1a: Meta|60/100',
      '|switch|p2a: Snurch|Goodra-Hisui, F|100/100',
      '|move|p1a: Meta|Explosion|p2a: Snurch',
      '|-damage|p2a: Snurch|52/100',
      '|faint|p1a: Meta',
    ]);
    expect(k(r, 'p2', 'Goodra-Hisui')).toBe(1);
    expect(k(r, 'p2', 'Slowbro')).toBe(0);
  });

  test('Healing Wish credits the opposing active mon (s11-sapphire-w8m44)', () => {
    const r = run([
      '|switch|p1a: CM|Indeedee-F, F|18/100',
      '|switch|p2a: Kingfin|Empoleon, F|100/100',
      '|move|p1a: CM|Healing Wish|p1a: CM',
      '|faint|p1a: CM',
    ]);
    expect(k(r, 'p2', 'Empoleon')).toBe(1);
  });

  test('Perish Song (no damage line, not a sacrifice) still credits no one', () => {
    const r = run([
      '|switch|p1a: X|Snorlax, M|100/100',
      '|switch|p2a: Y|Gengar, M|100/100',
      '|move|p2a: Y|Shadow Ball|p1a: X',
      '|-damage|p1a: X|50/100',
      '|-start|p1a: X|perish0',
      '|faint|p1a: X',
    ]);
    expect(k(r, 'p2', 'Gengar')).toBe(0);
  });
});

describe('weather → setter', () => {
  test('Sandstorm KO credits the Sand Stream mon, not a stale attacker (s11-emerald-psf6)', () => {
    const r = run([
      '|switch|p1a: Tang|Tangrowth, M|100/100',
      '|switch|p2a: Sceptile|Sceptile, M|100/100',
      '|move|p1a: Tang|Knock Off|p2a: Sceptile',
      '|-damage|p2a: Sceptile|40/100',
      '|switch|p1a: Ttar|Tyranitar, M|100/100',
      '|-weather|Sandstorm|[from] ability: Sand Stream|[of] p1a: Ttar',
      '|switch|p1a: Thetis|Primarina, F|100/100',
      '|-weather|Sandstorm|[upkeep]',
      '|-damage|p2a: Sceptile|0 fnt|[from] Sandstorm',
      '|faint|p2a: Sceptile',
    ]);
    expect(k(r, 'p1', 'Tyranitar')).toBe(1);
    expect(k(r, 'p1', 'Tangrowth')).toBe(0);
  });

  test('move-set sand credits whoever last set it', () => {
    const r = run([
      '|switch|p1a: Hippo|Hippowdon, M|100/100',
      '|switch|p2a: Lele|Tapu Lele|10/100',
      '|move|p1a: Hippo|Sandstorm|',
      '|-weather|Sandstorm',
      '|-damage|p2a: Lele|0 fnt|[from] Sandstorm',
      '|faint|p2a: Lele',
      '|switch|p2a: Lele2|Lilligant, F|100/100',
      '|move|p2a: Lele2|Sandstorm|',
      '|-weather|Sandstorm',
      '|switch|p1a: Volc|Volcarona, F|5/100',
      '|-damage|p1a: Volc|0 fnt|[from] Sandstorm',
      '|faint|p1a: Volc',
    ]);
    expect(k(r, 'p1', 'Hippowdon')).toBe(1);
    expect(k(r, 'p2', 'Lilligant')).toBe(1);
  });
});

test('own-side sand credits no one', () => {
  const r = run([
    '|switch|p1a: Ttar|Tyranitar, M|100/100',
    '|-weather|Sandstorm|[from] ability: Sand Stream|[of] p1a: Ttar',
    '|switch|p2a: X|Garchomp, M|100/100',
    '|switch|p1a: Volc|Volcarona, F|5/100',
    '|-damage|p1a: Volc|0 fnt|[from] Sandstorm',
    '|faint|p1a: Volc',
  ]);
  expect(r.pokemon.reduce((s, p) => s + p.kills, 0)).toBe(0);
});

describe('residual effects → original applier', () => {
  test('Salt Cure credits Garganacl even after another mon hits the victim (s11-ruby-w2m4)', () => {
    const r = run([
      '|switch|p1a: Garg|Garganacl, M|100/100',
      '|switch|p2a: Molt|Moltres-Galar|100/100',
      '|move|p1a: Garg|Salt Cure|p2a: Molt',
      '|-damage|p2a: Molt|60/100',
      '|-start|p2a: Molt|Salt Cure',
      '|switch|p1a: Alo|Alomomola, M|100/100',
      '|move|p1a: Alo|Scald|p2a: Molt',
      '|-damage|p2a: Molt|10/100',
      '|-damage|p2a: Molt|0 fnt|[from] Salt Cure',
      '|faint|p2a: Molt',
    ]);
    expect(k(r, 'p1', 'Garganacl')).toBe(1);
    expect(k(r, 'p1', 'Alomomola')).toBe(0);
  });

  test('Leech Seed credits the original seeder, not the slot occupant', () => {
    const r = run([
      '|switch|p1a: Bulba|Bulbasaur, M|100/100',
      '|switch|p2a: Lop|Lopunny-Mega, F|20/100',
      '|move|p1a: Bulba|Leech Seed|p2a: Lop',
      '|-start|p2a: Lop|move: Leech Seed',
      '|switch|p1a: Corv|Corviknight, F|100/100',
      '|-damage|p2a: Lop|0 fnt|[from] Leech Seed|[of] p1a: Corv',
      '|faint|p2a: Lop',
    ]);
    expect(k(r, 'p1', 'Bulbasaur')).toBe(1);
    expect(k(r, 'p1', 'Corviknight')).toBe(0);
  });

  test('Future Sight (logged as a plain -damage after -end) credits the caster', () => {
    const r = run([
      '|switch|p1a: Dude|Slowking-Galar, M|100/100',
      '|switch|p2a: Cloud|Tornadus-Therian, M|100/100',
      '|move|p1a: Dude|Future Sight|p2a: Cloud',
      '|-start|p1a: Dude|move: Future Sight',
      '|switch|p1a: Tar|Tyranitar, M|100/100',
      '|-end|p2a: Cloud|move: Future Sight',
      '|-damage|p2a: Cloud|0 fnt',
      '|faint|p2a: Cloud',
    ]);
    expect(k(r, 'p1', 'Slowking-Galar')).toBe(1);
    expect(k(r, 'p1', 'Tyranitar')).toBe(0);
  });
});

describe('tricked orbs → Trick user', () => {
  test('Toxic Orb tricked onto Rotom-Heat credits the Trick partner (s11-sapphire-w9m50)', () => {
    const r = run([
      '|switch|p1a: PS|Rotom-Heat|100/100',
      '|switch|p2a: Glis|Gliscor, M|100/100',
      '|move|p1a: PS|Trick|p2a: Glis',
      '|-activate|p1a: PS|move: Trick|[of] p2a: Glis',
      '|-item|p2a: Glis|Choice Scarf|[from] move: Trick',
      '|-item|p1a: PS|Toxic Orb|[from] move: Trick',
      '|-status|p1a: PS|tox|[from] item: Toxic Orb',
      '|switch|p2a: Pex|Toxapex, F|100/100',
      '|-damage|p1a: PS|0 fnt|[from] psn',
      '|faint|p1a: PS',
    ]);
    expect(k(r, 'p2', 'Gliscor')).toBe(1);
    expect(k(r, 'p2', 'Toxapex')).toBe(0);
  });

  test('own Toxic Orb still credits no one', () => {
    const r = run([
      '|switch|p1a: G|Gliscor, M|100/100',
      '|switch|p2a: X|Toxapex, F|100/100',
      '|-status|p1a: G|tox|[from] item: Toxic Orb',
      '|-damage|p1a: G|0 fnt|[from] psn',
      '|faint|p1a: G',
    ]);
    expect(k(r, 'p2', 'Toxapex')).toBe(0);
  });
});

describe('Illusion', () => {
  test('a reveal moves only the disguised stint off a real mon that already played', () => {
    const r = run([
      '|poke|p1|Gengar, M|',
      '|poke|p1|Zoroark, M|',
      '|switch|p1a: Gengar|Gengar, M|100/100',
      '|switch|p2a: A|Alakazam, M|100/100',
      '|move|p1a: Gengar|Shadow Ball|p2a: A',
      '|-damage|p2a: A|0 fnt',
      '|faint|p2a: A',
      '|switch|p2a: B|Blissey, F|100/100',
      '|switch|p1a: Gengar|Gengar, M|100/100', // Zoroark disguised as Gengar
      '|move|p1a: Gengar|Night Daze|p2a: B',
      '|-damage|p2a: B|0 fnt',
      '|faint|p2a: B',
      '|switch|p2a: C|Chansey, F|100/100',
      '|move|p2a: C|Seismic Toss|p1a: Gengar',
      '|replace|p1a: Gengar|Zoroark, M|',
      '|-damage|p1a: Gengar|0 fnt',
      '|faint|p1a: Gengar',
    ]);
    const gengar = r.pokemon.find(p => p.species === 'Gengar')!;
    const zoroark = r.pokemon.find(p => p.species === 'Zoroark')!;
    expect(gengar.kills).toBe(1);
    expect(gengar.deaths).toBe(0);
    expect(gengar.appeared).toBe(true);
    expect(zoroark.kills).toBe(1);
    expect(zoroark.deaths).toBe(1);
  });
});
