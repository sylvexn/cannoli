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

const replayDir = join(__dirname, '../../test/fixtures/replays');

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

    // Orientation: PS picks p1/p2 by challenge order. The Cannoli home team
    // can land on either side. Without this remap the Arena HUD shows ~half
    // of all matches with home/away inverted.
    test('homeSide=p1: home is p1 (default behavior)', () => {
      const parser = new ReplayParser();
      for (const line of log.split('\n')) parser.feedLine(line);
      const live = parser.getLiveStats('p1');
      expect(live.home.player).toBe('ROA_Bio');     // p1
      expect(live.away.player).toBe('hellofellorat'); // p2
    });

    test('homeSide=p2: home maps to p2, away to p1', () => {
      const parser = new ReplayParser();
      for (const line of log.split('\n')) parser.feedLine(line);
      const live = parser.getLiveStats('p2');
      expect(live.home.player).toBe('hellofellorat'); // p2
      expect(live.away.player).toBe('ROA_Bio');       // p1
      // teraRemaining flags must follow the swap too
      const liveDefault = parser.getLiveStats('p1');
      expect(live.terasRemaining.home).toBe(liveDefault.terasRemaining.away);
      expect(live.terasRemaining.away).toBe(liveDefault.terasRemaining.home);
    });

    test('homeSide swap also rotates pokemon lists', () => {
      const parser = new ReplayParser();
      for (const line of log.split('\n')) parser.feedLine(line);
      const liveP1Home = parser.getLiveStats('p1');
      const liveP2Home = parser.getLiveStats('p2');
      // Same Pokemon, just relabeled which side is home.
      expect(liveP2Home.home.pokemon.map(p => p.species).sort())
        .toEqual(liveP1Home.away.pokemon.map(p => p.species).sort());
      expect(liveP2Home.away.pokemon.map(p => p.species).sort())
        .toEqual(liveP1Home.home.pokemon.map(p => p.species).sort());
    });
  });

  // Passive/residual-status kill attribution (feedback: Gaffz, S11 Emerald).
  // A burn/poison/toxic faint must credit whoever INFLICTED the status, not
  // whoever last hit the victim — and self-inflicted (Flame/Toxic Orb) status
  // gives NO enemy credit.
  describe('status-kill attribution', () => {
    // Build a minimal battle from raw protocol lines.
    const run = (lines: string[]) => ReplayParser.parse(lines.join('\n'));
    const kills = (r: ReturnType<typeof ReplayParser.parse>, species: string) =>
      r.pokemon.find(p => p.species === species)?.kills ?? 0;

    test('burn KO credits the burner, not the last mon to hit the victim', () => {
      const r = run([
        '|player|p1|Ash|',
        '|player|p2|Gary|',
        '|switch|p1a: Dragapult|Dragapult, M|100/100',
        '|switch|p2a: Skarmory|Skarmory, F|100/100',
        '|move|p1a: Dragapult|Flamethrower|p2a: Skarmory',
        '|-damage|p2a: Skarmory|30/100',
        '|-status|p2a: Skarmory|brn',
        '|switch|p1a: Muk|Muk-Alola, M|100/100',        // different attacker enters
        '|move|p1a: Muk|Body Press|p2a: Skarmory',        // Muk becomes lastAttacker
        '|-damage|p2a: Skarmory|10/100 brn',
        '|-damage|p2a: Skarmory|0 fnt|[from] brn',        // dies to the burn
        '|faint|p2a: Skarmory',
        '|win|Ash',
      ]);
      expect(kills(r, 'Dragapult')).toBe(1);
      expect(kills(r, 'Muk-Alola')).toBe(0);
    });

    test('burn KO credits the burner even when the victim self-targets last (Destiny Bond)', () => {
      const r = run([
        '|player|p1|Ash|',
        '|player|p2|Gary|',
        '|switch|p1a: Milotic|Milotic, F|100/100',
        '|switch|p2a: Gengar|Gengar, F|100/100',
        '|move|p1a: Milotic|Scald|p2a: Gengar',
        '|-damage|p2a: Gengar|20/100',
        '|-status|p2a: Gengar|brn',
        '|move|p2a: Gengar|Destiny Bond|p2a: Gengar',     // self-target ⇒ lastAttacker=self
        '|-damage|p2a: Gengar|0 fnt|[from] brn',
        '|faint|p2a: Gengar',
        '|win|Ash',
      ]);
      // Old bug: self-attacker was filtered by the same-side guard → kill lost.
      expect(kills(r, 'Milotic')).toBe(1);
      const total = r.pokemon.reduce((s, p) => s + p.kills, 0);
      const deaths = r.pokemon.reduce((s, p) => s + p.deaths, 0);
      expect(total).toBe(deaths);
    });

    test('toxic KO credits the Toxic user even after they switch out', () => {
      const r = run([
        '|player|p1|Ash|',
        '|player|p2|Gary|',
        '|switch|p1a: Toxapex|Toxapex, F|100/100',
        '|switch|p2a: Snorlax|Snorlax, M|100/100',
        '|move|p1a: Toxapex|Toxic|p2a: Snorlax',
        '|-status|p2a: Snorlax|tox',
        '|switch|p1a: Blissey|Blissey, F|100/100',        // toxic-setter leaves
        '|move|p1a: Blissey|Seismic Toss|p2a: Snorlax',   // Blissey = lastAttacker
        '|-damage|p2a: Snorlax|20/100 tox',
        '|-damage|p2a: Snorlax|0 fnt|[from] psn',          // toxic residual reads as psn
        '|faint|p2a: Snorlax',
        '|win|Ash',
      ]);
      expect(kills(r, 'Toxapex')).toBe(1);
      expect(kills(r, 'Blissey')).toBe(0);
    });

    test('self-inflicted Flame Orb burn KO credits no one', () => {
      const r = run([
        '|player|p1|Ash|',
        '|player|p2|Gary|',
        '|switch|p1a: Weavile|Weavile, M|100/100',
        '|switch|p2a: Conkeldurr|Conkeldurr, M|100/100',
        '|move|p1a: Weavile|Ice Shard|p2a: Conkeldurr',    // Weavile = lastAttacker
        '|-damage|p2a: Conkeldurr|90/100',
        '|-status|p2a: Conkeldurr|brn|[from] item: Flame Orb',
        '|-damage|p2a: Conkeldurr|0 fnt|[from] brn',
        '|faint|p2a: Conkeldurr',
        '|win|Gary',
      ]);
      expect(kills(r, 'Weavile')).toBe(0);
    });

    test('a statused mon KO’d by a DIRECT hit still credits the attacker (no status hijack)', () => {
      const r = run([
        '|player|p1|Ash|',
        '|player|p2|Gary|',
        '|switch|p1a: Muk|Muk-Alola, M|100/100',
        '|switch|p2a: Arboliva|Arboliva, M|100/100',
        '|move|p1a: Muk|Toxic|p2a: Arboliva',
        '|-status|p2a: Arboliva|tox',
        '|switch|p1a: Dragapult|Dragapult, M|100/100',
        '|move|p1a: Dragapult|Flamethrower|p2a: Arboliva',
        '|-damage|p2a: Arboliva|0 fnt',                    // DIRECT KO, no [from]
        '|faint|p2a: Arboliva',
        '|win|Ash',
      ]);
      expect(kills(r, 'Dragapult')).toBe(1);
      expect(kills(r, 'Muk-Alola')).toBe(0);
    });
  });

  // Real S11 Emerald replay (jarret vs quintonius, battle-68) — the exact match
  // from the feedback report. Locks in the corrected passive-burn attribution
  // and the clean team-preview reconciliation (no phantom Greninja-*, Mega
  // Lopunny present with its death).
  describe('S11 Emerald jarret vs quintonius (real replay)', () => {
    const log = readFileSync(
      join(replayDir, 'Gen9NatDexDraft-2026-s11-emerald-jarret-quintonius.log'),
      'utf-8',
    );
    const result = ReplayParser.parse(log);
    const mon = (species: string) => result.pokemon.find(p => p.species === species);

    test('every death has a killer (total kills equals total deaths)', () => {
      const totalKills = result.pokemon.reduce((s, p) => s + p.kills, 0);
      const totalDeaths = result.pokemon.reduce((s, p) => s + p.deaths, 0);
      expect(totalDeaths).toBe(8);
      expect(totalKills).toBe(8);
    });

    test('Dragapult gets the Skarmory burn kill (3 total)', () => {
      expect(mon('Dragapult')?.kills).toBe(3);
    });

    test('Milotic gets the Gengar burn kill (1 total)', () => {
      expect(mon('Milotic')?.kills).toBe(1);
    });

    test('Muk-Alola no longer over-credited (2, not 3)', () => {
      expect(mon('Muk-Alola')?.kills).toBe(2);
    });

    test('Mega Lopunny appears with its death (no phantom placeholder mons)', () => {
      expect(mon('Lopunny-Mega')?.deaths).toBe(1);
      expect(mon('Lopunny-Mega')?.appeared).toBe(true);
      // Greninja's Battle-Bond team-preview placeholder must be reconciled away.
      expect(result.pokemon.some(p => p.species.endsWith('-*'))).toBe(false);
      // Exactly six brought per side (12 total), no duplicate/phantom entries.
      expect(result.pokemon.filter(p => p.player === 'p2' && p.brought).length).toBe(6);
    });
  });
});
