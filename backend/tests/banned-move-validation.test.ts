/**
 * Per-league banned-MOVE validation (warn-only).
 *
 * From the S11 rules sheets the only per-format move differences are:
 *   - Emerald (natdex)        bans Jet Punch (Palafin); Ruby/Sapphire allow it.
 *   - Ruby/Sapphire (natdex+) ban Take Heart; Emerald allows it.
 *
 * The parser records every move USED in the battle (result.movesUsed) and
 * validateMatchResult flags any that are banned in the league's cost format —
 * warn-only, so the match is never disputed.
 *
 * Run: bun test backend/tests/banned-move-validation.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { ReplayParser, validateMatchResult } from '../src/lib/replay-parser';

function parse(lines: string[]) {
  const parser = new ReplayParser();
  for (const line of lines) parser.feedLine(line);
  return parser.getResult();
}

// p1 = Palafin (Alice/home) clicks Jet Punch on p2 = Snorlax (Bob/away).
const JET_PUNCH_LOG = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|poke|p1|Palafin, M|',
  '|poke|p2|Snorlax, M|',
  '|teampreview',
  '|start',
  '|switch|p1a: Fin|Palafin, M|100/100',
  '|switch|p2a: Lax|Snorlax, M|100/100',
  '|turn|1',
  '|move|p1a: Fin|Jet Punch|p2a: Lax',
  '|win|Alice',
];

// p2 = Snorlax clicks Take Heart.
const TAKE_HEART_LOG = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|poke|p1|Palafin, M|',
  '|poke|p2|Snorlax, M|',
  '|teampreview',
  '|start',
  '|switch|p1a: Fin|Palafin, M|100/100',
  '|switch|p2a: Lax|Snorlax, M|100/100',
  '|turn|1',
  '|move|p2a: Lax|Take Heart|p2a: Lax',
  '|win|Alice',
];

const HOME = [{ pokemonName: 'Palafin', isTeraCaptain: false }];
const AWAY = [{ pokemonName: 'Snorlax', isTeraCaptain: false }];

describe('ReplayParser — movesUsed', () => {
  test('records the (side, species, move) of every move clicked', () => {
    const result = parse(JET_PUNCH_LOG);
    expect(result.movesUsed).toContainEqual({ side: 'p1', species: 'Palafin', move: 'Jet Punch' });
  });

  test('dedupes a move used multiple times', () => {
    const result = parse([
      ...JET_PUNCH_LOG.slice(0, -1),
      '|move|p1a: Fin|Jet Punch|p2a: Lax',
      '|win|Alice',
    ]);
    const jp = result.movesUsed.filter(m => m.move === 'Jet Punch');
    expect(jp.length).toBe(1);
  });
});

describe('validateMatchResult — per-league banned moves (warn-only)', () => {
  function bannedMoveWarnings(result: ReturnType<typeof parse>, format: string | null) {
    return validateMatchResult(result, HOME, AWAY, 'HOM', 'AWY', 'p1', format)
      .filter(w => w.type === 'banned_move');
  }

  test('Jet Punch is flagged in natdex (Emerald), attributed to the home team', () => {
    const w = bannedMoveWarnings(parse(JET_PUNCH_LOG), 'natdex');
    expect(w.length).toBe(1);
    expect(w[0].team).toBe('HOM');
    expect(w[0].pokemon).toBe('Palafin');
    expect(w[0].warnOnly).toBe(true);
  });

  test('Jet Punch is NOT flagged in natdexplus (Ruby/Sapphire)', () => {
    expect(bannedMoveWarnings(parse(JET_PUNCH_LOG), 'natdexplus').length).toBe(0);
  });

  test('Take Heart is flagged in natdexplus, attributed to the away team', () => {
    const w = bannedMoveWarnings(parse(TAKE_HEART_LOG), 'natdexplus');
    expect(w.length).toBe(1);
    expect(w[0].team).toBe('AWY');
    expect(w[0].warnOnly).toBe(true);
  });

  test('Take Heart is NOT flagged in natdex', () => {
    expect(bannedMoveWarnings(parse(TAKE_HEART_LOG), 'natdex').length).toBe(0);
  });

  test('no leagueFormat → no banned-move checks at all', () => {
    expect(bannedMoveWarnings(parse(JET_PUNCH_LOG), null).length).toBe(0);
  });

  test('banned-move warnings never block (all warnOnly)', () => {
    const all = validateMatchResult(parse(JET_PUNCH_LOG), HOME, AWAY, 'HOM', 'AWY', 'p1', 'natdex');
    expect(all.filter(w => w.type === 'banned_move').every(w => w.warnOnly === true)).toBe(true);
  });
});
