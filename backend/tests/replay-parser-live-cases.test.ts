/**
 * Live-style replay cases NOT covered by the two existing suites
 * (replay-parser.test.ts = full real fixtures, replay-parser-edge-cases.test.ts
 * = K/D attribution branches). Showdown area #4.
 *
 * Focus:
 *   - Tera capture (type + per-side teraRemaining flag) and tera on a mon that
 *     switched in after team preview
 *   - Mega / form change via |detailschange| transferring K/D stats
 *   - Mid-battle forfeit / disconnect: PS emits a plain |win|WINNER with the
 *     loser keeping live mons (score should reflect surviving mons, not 0)
 *   - Tie: |tie| → winner=null, both scores 0
 *   - validateMatchResult: illegal roster mon, unauthorized tera, format
 *     mismatch — with homeSide orientation (p1 AND p2) so the bot's
 *     orientation-resolution path is exercised both ways.
 */
import { describe, expect, test } from 'bun:test';
import { ReplayParser, validateMatchResult } from '../src/lib/replay-parser';

function feed(p: ReplayParser, lines: string[]) {
  for (const l of lines) p.feedLine(l);
}

const preamble = (p1: string, p2: string) => [
  `|player|p1|${p1}|`,
  `|player|p2|${p2}|`,
  '|tier|[Gen 9] NatDex Draft',
];

describe('Tera capture', () => {
  test('records teraType and flips per-side teraRemaining', () => {
    const p = new ReplayParser();
    feed(p, [
      ...preamble('Alice', 'Bob'),
      '|poke|p1|Garchomp, M|',
      '|poke|p2|Kingambit, M|',
      '|start',
      '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Gambit|Kingambit, M|100/100',
      '|turn|1',
      '|-terastallize|p1a: Chomp|Steel',
    ]);
    const r = p.getResult();
    const chomp = r.pokemon.find(x => x.species === 'Garchomp')!;
    expect(chomp.teraUsed).toBe(true);
    expect(chomp.teraType).toBe('Steel');

    // p1 is home → p1 tera spent, p2 tera still available.
    const live = p.getLiveStats('p1');
    expect(live.terasRemaining.home).toBe(false);
    expect(live.terasRemaining.away).toBe(true);
  });

  test('tera on a mon switched in mid-battle still attributes to that species', () => {
    const p = new ReplayParser();
    feed(p, [
      ...preamble('Alice', 'Bob'),
      '|poke|p1|Garchomp, M|',
      '|poke|p1|Volcarona, M|',
      '|poke|p2|Kingambit, M|',
      '|start',
      '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Gambit|Kingambit, M|100/100',
      '|turn|1',
      '|switch|p1a: Volc|Volcarona, M|100/100',
      '|-terastallize|p1a: Volc|Fire',
    ]);
    const r = p.getResult();
    const volc = r.pokemon.find(x => x.species === 'Volcarona')!;
    expect(volc.teraUsed).toBe(true);
    expect(volc.teraType).toBe('Fire');
    const chomp = r.pokemon.find(x => x.species === 'Garchomp')!;
    expect(chomp.teraUsed).toBe(false);
  });
});

describe('Mega / form change (|detailschange|)', () => {
  test('K/D earned before mega is preserved on the mega species key', () => {
    const p = new ReplayParser();
    feed(p, [
      ...preamble('Alice', 'Bob'),
      '|poke|p1|Charizard, M|',
      '|poke|p2|Snorlax, M|',
      '|poke|p2|Pikachu, M|',
      '|start',
      '|switch|p1a: Zard|Charizard, M|100/100',
      '|switch|p2a: Lax|Snorlax, M|100/100',
      '|turn|1',
      // Charizard KOs Snorlax pre-mega.
      '|move|p1a: Zard|Flamethrower|p2a: Lax',
      '|-damage|p2a: Lax|0 fnt',
      '|faint|p2a: Lax',
      '|switch|p2a: Pika|Pikachu, M|100/100',
      '|turn|2',
      // Now Charizard mega-evolves to Charizard-Mega-Y.
      '|detailschange|p1a: Zard|Charizard-Mega-Y, M',
      '|move|p1a: Zard|Air Slash|p2a: Pika',
      '|-damage|p2a: Pika|0 fnt',
      '|faint|p2a: Pika',
    ]);
    const r = p.getResult();
    // The pre-mega Charizard entry must have been re-keyed; no stray base entry
    // should hold the first kill.
    const baseZard = r.pokemon.find(x => x.species === 'Charizard');
    const megaZard = r.pokemon.find(x => x.species === 'Charizard-Mega-Y');
    expect(baseZard).toBeUndefined();
    expect(megaZard).toBeTruthy();
    expect(megaZard!.kills).toBe(2); // both KOs carried over + accrued
    expect(megaZard!.player).toBe('p1');
  });
});

describe('Mid-battle forfeit / disconnect', () => {
  // PS represents a forfeit/disconnect/timeout as a plain |win|WINNER while
  // the loser may still have undefeated mons on the field. Feedback #81: this
  // must score as a completed sweep (loser forced to 0), with the loser's
  // survivors credited as owed kills to the winner's active mon — NOT a
  // brought-minus-deaths score that leaves the loser with points on the board.
  test('forfeit win forces the loser to 0 and credits owed kills to the winner active mon', () => {
    const p = new ReplayParser();
    feed(p, [
      ...preamble('Alice', 'Bob'),
      '|poke|p1|Garchomp, M|',
      '|poke|p1|Volcarona, M|',
      '|poke|p2|Kingambit, M|',
      '|poke|p2|Dragapult, M|',
      '|start',
      '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Gambit|Kingambit, M|100/100',
      '|turn|1',
      // Alice KOs one of Bob's mons, then Bob forfeits with 1 left.
      '|move|p1a: Chomp|Earthquake|p2a: Gambit',
      '|-damage|p2a: Gambit|0 fnt',
      '|faint|p2a: Gambit',
      '|win|Alice',
    ]);
    const r = p.getResult();
    expect(r.winner).toBe('Alice');
    expect(r.loser).toBe('Bob');
    // Alice (p1) brought 2, lost 0 → 2, unaffected.
    expect(r.winnerScore).toBe(2);
    // Bob forced to 0 instead of his raw 1 survivor.
    expect(r.loserScore).toBe(0);

    const dragapult = r.pokemon.find(x => x.species === 'Dragapult');
    expect(dragapult?.deaths).toBe(1); // the surviving mon becomes a death
    // Chomp (p1a, still active at |win|) gets its real KO on Gambit PLUS the
    // 1 owed kill from Dragapult's forced death.
    const chomp = r.pokemon.find(x => x.species === 'Garchomp');
    expect(chomp?.kills).toBe(2);
    const volc = r.pokemon.find(x => x.species === 'Volcarona');
    expect(volc?.kills ?? 0).toBe(0); // owed kill goes to the ACTIVE mon only
  });

  test('immediate forfeit with no faints forces the loser to 0', () => {
    const p = new ReplayParser();
    feed(p, [
      ...preamble('Alice', 'Bob'),
      '|poke|p1|Garchomp, M|',
      '|poke|p1|Volcarona, M|',
      '|poke|p2|Kingambit, M|',
      '|start',
      '|win|Alice', // Bob DCs at team preview
    ]);
    const r = p.getResult();
    expect(r.winner).toBe('Alice');
    expect(r.winnerScore).toBe(2); // p1 brought 2
    expect(r.loserScore).toBe(0);  // forced from 1 (Bob's brought Kingambit)
  });
});

describe('Tie', () => {
  test('|tie| yields null winner and zero scores', () => {
    const p = new ReplayParser();
    feed(p, [
      ...preamble('Alice', 'Bob'),
      '|poke|p1|Garchomp, M|',
      '|poke|p2|Kingambit, M|',
      '|start',
      '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Gambit|Kingambit, M|100/100',
      '|turn|1',
      '|-damage|p1a: Chomp|0 fnt',
      '|faint|p1a: Chomp',
      '|-damage|p2a: Gambit|0 fnt',
      '|faint|p2a: Gambit',
      '|tie',
    ]);
    const r = p.getResult();
    expect(r.winner).toBeNull();
    expect(r.loser).toBeNull();
    expect(r.winnerScore).toBe(0);
    expect(r.loserScore).toBe(0);
  });
});

describe('validateMatchResult orientation + illegal rosters', () => {
  const homeRoster = [
    { pokemonName: 'Garchomp', isTeraCaptain: false },
    { pokemonName: 'Volcarona', isTeraCaptain: true },
  ];
  const awayRoster = [
    { pokemonName: 'Kingambit', isTeraCaptain: true },
    { pokemonName: 'Dragapult', isTeraCaptain: false },
  ];

  function buildResult(homeSide: 'p1' | 'p2', opts: { illegal?: boolean; unauthorizedTera?: boolean; format?: string }) {
    const p = new ReplayParser();
    const homeP = homeSide;
    const awayP = homeSide === 'p1' ? 'p2' : 'p1';
    const lines = [
      '|player|p1|HomeOrAway1|',
      '|player|p2|HomeOrAway2|',
      `|tier|${opts.format ?? '[Gen 9] NatDex Draft'}`,
      `|poke|${homeP}|Garchomp, M|`,
      `|poke|${homeP}|Volcarona, M|`,
      `|poke|${awayP}|Kingambit, M|`,
      `|poke|${awayP}|Dragapult, M|`,
      '|start',
      `|switch|${homeP}a: Chomp|Garchomp, M|100/100`,
      `|switch|${awayP}a: Gambit|Kingambit, M|100/100`,
      '|turn|1',
    ];
    if (opts.illegal) {
      // Home brings a mon not on its roster.
      lines.push(`|switch|${homeP}b: Sneaky|Mewtwo, M|100/100`);
    }
    if (opts.unauthorizedTera) {
      // Home's Garchomp (NOT a captain) terastallizes → unauthorized.
      lines.push(`|-terastallize|${homeP}a: Chomp|Steel`);
    }
    feed(p, lines);
    return p.getResult();
  }

  for (const homeSide of ['p1', 'p2'] as const) {
    test(`clean result, homeSide=${homeSide} → no warnings`, () => {
      const result = buildResult(homeSide, {});
      const w = validateMatchResult(result, homeRoster, awayRoster, 'HOM', 'AWY', homeSide);
      expect(w).toEqual([]);
    });

    test(`illegal home mon, homeSide=${homeSide} → flagged against HOME team`, () => {
      const result = buildResult(homeSide, { illegal: true });
      const w = validateMatchResult(result, homeRoster, awayRoster, 'HOM', 'AWY', homeSide);
      const illegal = w.find(x => x.type === 'invalid_pokemon');
      expect(illegal).toBeTruthy();
      expect(illegal!.team).toBe('HOM'); // orientation correct regardless of side
      expect(illegal!.pokemon).toBe('Mewtwo');
    });

    test(`unauthorized tera by non-captain, homeSide=${homeSide} → flagged against HOME`, () => {
      const result = buildResult(homeSide, { unauthorizedTera: true });
      const w = validateMatchResult(result, homeRoster, awayRoster, 'HOM', 'AWY', homeSide);
      const tera = w.find(x => x.type === 'unauthorized_tera');
      expect(tera).toBeTruthy();
      expect(tera!.team).toBe('HOM');
      expect(tera!.pokemon).toBe('Garchomp');
    });
  }

  test('captain tera is allowed (Volcarona is a captain)', () => {
    const p = new ReplayParser();
    feed(p, [
      ...preamble('H', 'A'),
      '|poke|p1|Volcarona, M|',
      '|poke|p2|Kingambit, M|',
      '|start',
      '|switch|p1a: Volc|Volcarona, M|100/100',
      '|switch|p2a: Gambit|Kingambit, M|100/100',
      '|turn|1',
      '|-terastallize|p1a: Volc|Fire',
    ]);
    const w = validateMatchResult(p.getResult(), homeRoster, awayRoster, 'HOM', 'AWY', 'p1');
    expect(w.find(x => x.type === 'unauthorized_tera')).toBeUndefined();
  });

  test('format mismatch is flagged', () => {
    const result = buildResult('p1', { format: '[Gen 9] OU' });
    const w = validateMatchResult(result, homeRoster, awayRoster, 'HOM', 'AWY', 'p1');
    expect(w.find(x => x.type === 'format_mismatch')).toBeTruthy();
  });
});
