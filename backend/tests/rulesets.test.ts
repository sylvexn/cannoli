/**
 * Rulesets foundation: golden parity (old hardcoded rules vs the shared module on
 * the archived S9/S10/S11 rosters) + backfill/resolver behaviour on a scratch DB.
 */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { resolve } from 'path';
import { DEFAULT_RULESET, captainEligible, captainHeadroomNeeded, markupCost, rosterBand, rosterCost } from '@cannoli/rules';
import { effectiveCost } from '../src/lib/tera-cost';
import { backfillRulesets } from '../scripts/backfill-rulesets';
import golden from './fixtures/rulesets-golden.json';

type Mon = [tier: number, costAtDraft: number, isCaptain: number, teraBanned: number];

/** Verbatim old rule: draft-engine.captainHeadroomNeeded / FE draft-rules (tier 1..9, not tera-banned). */
function oldHeadroom(mons: { tier: number; tb: boolean }[], slots: number): number {
  if (slots <= 0) return 0;
  const m = mons.filter(r => r.tier >= 1 && r.tier <= 9 && !r.tb)
    .map(r => Math.max(0, effectiveCost(r.tier, true) - r.tier)).sort((a, b) => b - a);
  let t = 0;
  for (let i = 0; i < Math.min(slots, m.length); i++) t += m[i];
  return t;
}

describe('golden parity: archived rosters', () => {
  const teams = golden.teams as { league: string; team: string; mons: Mon[] }[];
  test('fixture covers every archived team', () => {
    expect(teams.length).toBeGreaterThan(90);
    expect(teams.reduce((n, t) => n + t.mons.length, 0)).toBeGreaterThan(1000);
  });

  test('roster cost (legacy fallback: costAtDraft || tier) is identical', () => {
    for (const t of teams) {
      const resolved = t.mons.map(([tier, c, cap]) => ({ cost: c || tier, isCaptain: !!cap }));
      const oldTotal = resolved.reduce((s, r) => s + effectiveCost(r.cost, r.isCaptain), 0);
      expect(rosterCost(DEFAULT_RULESET, resolved)).toBe(oldTotal);
      for (const r of resolved) expect(markupCost(DEFAULT_RULESET, r.cost, r.isCaptain)).toBe(effectiveCost(r.cost, r.isCaptain));
    }
  });

  test('captain eligibility + headroom identical', () => {
    for (const t of teams) {
      const mons = t.mons.map(([tier, , , tb]) => ({ tier, tb: !!tb }));
      for (const m of mons) {
        expect(captainEligible(DEFAULT_RULESET, { tier: m.tier, teraBanned: m.tb })).toBe(m.tier >= 1 && m.tier <= 9 && !m.tb);
      }
      const shared = mons.map(m => ({ tier: m.tier, teraBanned: m.tb }));
      for (const slots of [0, 1, 2, 3]) {
        expect(captainHeadroomNeeded(DEFAULT_RULESET, shared, slots)).toBe(oldHeadroom(mons, slots));
      }
    }
  });

  test('legacy band semantics: NULL/NULL -> exactly rosterSize; S11 override wins', () => {
    expect(rosterBand(DEFAULT_RULESET)).toEqual({ min: 10, max: 10 });
    expect(rosterBand(DEFAULT_RULESET, { min: 10, max: 12 })).toEqual({ min: 10, max: 12 });
  });
});

function scratchDb(): Database {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: resolve(import.meta.dir, '../drizzle') });
  return sqlite;
}

describe('backfill-rulesets', () => {
  function seed(db: Database) {
    db.exec(`
      INSERT INTO seasons (id, season_number, point_cap, tera_captain_slots) VALUES (1, 10, 110, 2), (2, 11, 110, 2);
      INSERT INTO leagues (id, name, color, season_id, phase, cost_format) VALUES
        ('a','A','#fff',1,'offseason','natdexplus'), ('b','B','#fff',1,'offseason','natdex');
      INSERT INTO leagues (id, name, color, season_id, phase, cost_format, min_roster_size, max_roster_size) VALUES
        ('c','C','#fff',2,'predraft','natdexplus',10,12);
      INSERT INTO draft_templates (name, tier_list_snapshot, point_cap, roster_size, captain_count) VALUES ('Old', '[]', 100, 11, 3);
      INSERT INTO draft_center_teams (id, user_id, name, league_id) SELECT 't1', id, 'x', 'c' FROM users LIMIT 1;
    `);
  }

  test('dry run writes nothing; apply is idempotent', () => {
    const db = scratchDb();
    db.exec("INSERT INTO users (username, password_hash) VALUES ('u','x')");
    seed(db);
    const dry = backfillRulesets(db, false);
    expect(dry.instances.map(i => i.leagues.sort().join())).toEqual(['a', 'b', 'c']);
    expect((db.prepare('SELECT COUNT(*) n FROM rulesets').get() as any).n).toBe(0);

    backfillRulesets(db, true);
    const leagues = db.prepare('SELECT id, ruleset_id FROM leagues').all() as any[];
    expect(leagues.every(l => l.ruleset_id != null)).toBe(true);
    const c = db.prepare('SELECT r.* FROM rulesets r JOIN leagues l ON l.ruleset_id = r.id WHERE l.id = ?').get('c') as any;
    expect([c.roster_min, c.roster_max, c.is_template, c.mega_cap, c.tera_types_per_captain]).toEqual([10, 12, 0, 1, 3]);
    expect(JSON.parse(c.tera_markup)['9']).toBe(12);
    const names = (db.prepare('SELECT name FROM rulesets WHERE is_template = 1').all() as any[]).map(r => r.name);
    expect(names).toContain('Default — NatDex+');
    expect(names).toContain('Old (legacy template)');
    expect((db.prepare("SELECT ruleset_id FROM draft_center_teams WHERE id='t1'").get() as any).ruleset_id).toBe(c.id);
    // legacy columns untouched
    expect((db.prepare('SELECT point_cap FROM seasons WHERE id = 1').get() as any).point_cap).toBe(110);

    const before = (db.prepare('SELECT COUNT(*) n FROM rulesets').get() as any).n;
    const again = backfillRulesets(db, true);
    expect(again.instances).toEqual([]);
    expect(again.templates).toEqual([]);
    expect((db.prepare('SELECT COUNT(*) n FROM rulesets').get() as any).n).toBe(before);
  });
});
