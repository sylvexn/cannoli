/**
 * Test the replay parser against real Showdown replay data.
 * Run: bun test backend/src/lib/replay-parser.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { ReplayParser } from './replay-parser';
import { readFileSync } from 'fs';
import { join } from 'path';

function extractBattleLog(htmlPath: string): string {
  const html = readFileSync(htmlPath, 'utf-8');
  const startMarker = '<script type="text/plain" class="battle-log-data">';
  const endMarker = '</script>';
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('No battle-log-data found');
  const logStart = start + startMarker.length;
  const end = html.indexOf(endMarker, logStart);
  return html.slice(logStart, end);
}

const replayDir = join(__dirname, '../../../frontend/public/replays');

describe('ReplayParser', () => {
  describe('ROA_Bio vs hellofellorat', () => {
    const log = extractBattleLog(join(replayDir, 'Gen9NatDexDraft-2026-03-29-roabio-hellofellorat.html'));
    const result = ReplayParser.parse(log);

    test('identifies players', () => {
      expect(result.players.p1).toBe('ROA_Bio');
      expect(result.players.p2).toBe('hellofellorat');
    });

    test('identifies winner', () => {
      expect(result.winner).toBe('hellofellorat');
      expect(result.loser).toBe('ROA_Bio');
    });

    test('identifies format', () => {
      expect(result.format).toBe('[Gen 9] NatDex Draft');
    });

    test('counts all 12 Pokemon from team preview', () => {
      const p1Mons = result.pokemon.filter(p => p.player === 'p1' && p.brought);
      const p2Mons = result.pokemon.filter(p => p.player === 'p2' && p.brought);
      expect(p1Mons.length).toBe(6);
      expect(p2Mons.length).toBe(6);
    });

    test('p1 loses all 6 Pokemon (all fainted)', () => {
      const p1Deaths = result.pokemon.filter(p => p.player === 'p1' && p.deaths > 0);
      // hellofellorat won, so ROA_Bio (p1) lost all mons
      // From the replay: Porygon-Z, Scizor, Arcanine, Tsareena, Clodsire, Araquanid all faint
      expect(p1Deaths.length).toBe(6);
    });

    test('p2 loses 4 Pokemon', () => {
      const p2Deaths = result.pokemon.filter(p => p.player === 'p2' && p.deaths > 0);
      // Herdier, Coalossal, Swampert, Weavile faint. Charizard and Hatterene survive...
      // Actually from the grep: Herdier, Coalossal, Swampert, Weavile all faint = 4 deaths
      expect(p2Deaths.length).toBe(4);
    });

    test('score reflects remaining Pokemon', () => {
      // hellofellorat (p2) wins: had 6, lost 4, so 2 remaining
      expect(result.winnerScore).toBe(2);
      expect(result.loserScore).toBe(0);
    });

    test('tracks tera usage', () => {
      // Coalossal terastallized to Fighting (p2)
      const coalossal = result.pokemon.find(p => p.species === 'Coalossal');
      expect(coalossal?.teraUsed).toBe(true);
      expect(coalossal?.teraType).toBe('Fighting');

      // Tsareena terastallized to Fairy (p1)
      const tsareena = result.pokemon.find(p => p.species === 'Tsareena');
      expect(tsareena?.teraUsed).toBe(true);
      expect(tsareena?.teraType).toBe('Fairy');
    });

    test('attributes Rocky Helmet kill to Coalossal', () => {
      // Scizor fainted from Rocky Helmet [of] p2a: Coalossal
      const coalossal = result.pokemon.find(p => p.species === 'Coalossal');
      expect(coalossal!.kills).toBeGreaterThanOrEqual(1);
    });

    test('total kills equal total deaths', () => {
      const totalKills = result.pokemon.reduce((s, p) => s + p.kills, 0);
      const totalDeaths = result.pokemon.reduce((s, p) => s + p.deaths, 0);
      expect(totalKills).toBe(totalDeaths);
    });
  });

  describe('simolili vs Gabrys24', () => {
    const log = extractBattleLog(join(replayDir, 'Gen9NatDexDraft-2026-04-03-simolili-gabrys24.html'));
    const result = ReplayParser.parse(log);

    test('identifies players', () => {
      expect(result.players.p1).toBe('simolili');
      expect(result.players.p2).toBe('Gabrys24!');
    });

    test('identifies winner', () => {
      expect(result.winner).toBe('Gabrys24!');
    });

    test('p1 all fainted (6 deaths)', () => {
      const p1Deaths = result.pokemon.filter(p => p.player === 'p1' && p.deaths > 0);
      // Politoed, Blastoise, Hawlucha, Grimmsnarl, Bellibolt, Porygon2 all faint
      expect(p1Deaths.length).toBe(6);
    });

    test('p2 loses 1 Pokemon (Muk)', () => {
      const p2Deaths = result.pokemon.filter(p => p.player === 'p2' && p.deaths > 0);
      expect(p2Deaths.length).toBe(1);
    });

    test('score is 5-0', () => {
      expect(result.winnerScore).toBe(5);
      expect(result.loserScore).toBe(0);
    });

    test('total kills equal total deaths', () => {
      const totalKills = result.pokemon.reduce((s, p) => s + p.kills, 0);
      const totalDeaths = result.pokemon.reduce((s, p) => s + p.deaths, 0);
      expect(totalKills).toBe(totalDeaths);
    });
  });

  describe('incremental (feedLine) produces same result as parse', () => {
    const log = extractBattleLog(join(replayDir, 'Gen9NatDexDraft-2026-03-29-roabio-hellofellorat.html'));

    test('feedLine result matches static parse', () => {
      const parser = new ReplayParser();
      for (const line of log.split('\n')) {
        parser.feedLine(line);
      }
      const incremental = parser.getResult();
      const batch = ReplayParser.parse(log);

      expect(incremental.winner).toBe(batch.winner);
      expect(incremental.loser).toBe(batch.loser);
      expect(incremental.winnerScore).toBe(batch.winnerScore);
      expect(incremental.loserScore).toBe(batch.loserScore);
      expect(incremental.pokemon.length).toBe(batch.pokemon.length);
    });
  });

  describe('getLiveStats', () => {
    const log = extractBattleLog(join(replayDir, 'Gen9NatDexDraft-2026-03-29-roabio-hellofellorat.html'));

    test('returns valid LiveMatchStats shape', () => {
      const parser = new ReplayParser();
      for (const line of log.split('\n')) {
        parser.feedLine(line);
      }
      const live = parser.getLiveStats();

      expect(live.home.player).toBe('ROA_Bio');
      expect(live.away.player).toBe('hellofellorat');
      expect(live.home.pokemon.length).toBe(6);
      expect(live.away.pokemon.length).toBe(6);
      expect(typeof live.turn).toBe('number');
      expect(typeof live.terasRemaining.home).toBe('boolean');
      expect(typeof live.terasRemaining.away).toBe('boolean');
    });
  });
});
