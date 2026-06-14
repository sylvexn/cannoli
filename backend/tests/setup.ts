/**
 * Test preload — runs once before any test file (registered in bunfig.toml
 * `[test].preload`).
 *
 * Many suites (draft-timer, pins-uniqueness, draft-reconnect, trade-validation,
 * season-lifecycle, …) need the ~1200-row `pokemon` reference table to exist:
 * fixtures pull a real mon by tier via `pickByTier`. Locally that table is
 * present because the dev DB was seeded from the XLSX. In CI the checkout has no
 * DB and no XLSX, so the table is created empty by the migration chain and those
 * tests throw "no seeded tier-N pokemon available" — which is exactly why the
 * Backend Tests CI job has never been green.
 *
 * This preload backfills the reference table from a committed JSON fixture
 * (exported from the authoritative XLSX-seeded DB) ONLY when it is empty, so:
 *   - CI's fresh/empty DB self-seeds and the data-dependent tests run for real;
 *   - a real seeded dev DB is left untouched (we no-op when rows already exist);
 *   - the insert is idempotent (`INSERT OR IGNORE` on the unique `name`).
 */
import { sqlite } from '../src/db';

type PokemonFixtureRow = {
  name: string;
  type1: string;
  type2: string | null;
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
  ability1: string | null;
  ability2: string | null;
  hidden_ability: string | null;
  tier: number;
  tera_banned: number;
  banned: number;
  national_dex_number: number | null;
  form_category: string;
};

const existing = sqlite.query('SELECT COUNT(*) AS c FROM pokemon').get() as { c: number };

if (existing.c === 0) {
  const rows = (await import('./fixtures/pokemon-reference.json', {
    with: { type: 'json' },
  })) as unknown as { default: PokemonFixtureRow[] };
  const fixture = rows.default;

  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO pokemon
      (name, type1, type2, hp, atk, def, spa, spd, spe,
       ability1, ability2, hidden_ability, tier, tera_banned, banned,
       national_dex_number, form_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = sqlite.transaction((list: PokemonFixtureRow[]) => {
    for (const p of list) {
      insert.run(
        p.name, p.type1, p.type2, p.hp, p.atk, p.def, p.spa, p.spd, p.spe,
        p.ability1, p.ability2, p.hidden_ability, p.tier, p.tera_banned, p.banned,
        p.national_dex_number, p.form_category,
      );
    }
  });

  seed(fixture);
  console.log(`[test-setup] seeded ${fixture.length} pokemon reference rows into empty DB`);
}
