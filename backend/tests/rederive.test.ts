import { describe, expect, test } from 'bun:test';
import { resolveStoredName, isHandCorrected, diffRows } from '../src/lib/rederive';

describe('resolveStoredName', () => {
  test('keeps a stored Mega even though the current roster only has the base', () => {
    expect(resolveStoredName(['Mega Tyranitar'], ['Tyranitar'], 'Tyranitar-Mega')).toBe('Mega Tyranitar');
  });
  test('keeps stored variant name over the base roster name', () => {
    expect(resolveStoredName(['Thundurus-Incarnate'], ['Thundurus'], 'Thundurus-Incarnate')).toBe('Thundurus-Incarnate');
  });
  test('falls back to the roster for new rows', () => {
    expect(resolveStoredName([], ['Mega Lopunny'], 'Lopunny-Mega')).toBe('Mega Lopunny');
  });
});

describe('isHandCorrected', () => {
  const m = { id: 'm1', forfeitedBy: null };
  test('force-result that rewrote pokemon', () => {
    expect(isHandCorrected(m, [{ type: 'match_force_result', metadata: JSON.stringify({ matchId: 'm1', pokemonRewritten: true }) }])).toBe(true);
  });
  test('force-result that did not touch pokemon is not a K/D correction', () => {
    expect(isHandCorrected(m, [{ type: 'match_force_result', metadata: JSON.stringify({ matchId: 'm1', pokemonRewritten: false }) }])).toBe(false);
  });
  test('other match / forfeit', () => {
    expect(isHandCorrected(m, [{ type: 'match_force_result', metadata: JSON.stringify({ matchId: 'm2', pokemonRewritten: true }) }])).toBe(false);
    expect(isHandCorrected({ id: 'm1', forfeitedBy: 'home' }, [])).toBe(true);
  });
});

describe('diffRows', () => {
  const r = (pokemonName: string, kills: number) => ({ teamId: 't', pokemonName, kills, deaths: 0, teraUsed: false, teraType: null });
  test('reports kill delta', () => {
    const d = diffRows([r('A', 1)], [r('A', 2)]);
    expect(d.changed).toBe(true);
    expect(d.killDelta).toBe(1);
  });
  test('identical -> unchanged', () => {
    expect(diffRows([r('A', 1)], [r('A', 1)]).changed).toBe(false);
  });
});
