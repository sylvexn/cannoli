/**
 * Idempotent seeding of the ~1200-row `pokemon` reference table from the
 * committed JSON fixture (exported from the authoritative XLSX-seeded DB).
 *
 * Used in two places:
 *   - the test preload (`setup.ts`), once, before any test file runs;
 *   - defensively by data-dependent fixtures (`draft-fixture.ts` `pickByTier`),
 *     because under `bun test tests/` the shared file DB is visible to every
 *     suite and an order-dependent reset in another suite (the ps-bot-seed vs
 *     live-DB race noted in .github/workflows/ci.yml) can empty the reference
 *     mid-run. Re-seeding on demand makes those reads order-independent instead
 *     of trusting the single preload seed to survive the whole suite.
 *
 * No-ops when rows already exist (real seeded dev DB, or already backfilled),
 * and the insert itself is `INSERT OR IGNORE` on the unique `name`, so calling
 * it repeatedly is always safe.
 */
import { sqlite } from '../src/db';
import fixture from './fixtures/pokemon-reference.json';

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

export function ensurePokemonReference(): void {
  const existing = sqlite.query('SELECT COUNT(*) AS c FROM pokemon').get() as { c: number };
  if (existing.c > 0) return;

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

  seed(fixture as PokemonFixtureRow[]);
}
