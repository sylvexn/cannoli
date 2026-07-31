import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, sql, asc } from 'drizzle-orm';
import { getFormatCostMap, listCostFormats, DEFAULT_COST_FORMAT } from '../../lib/league-costs';

/**
 * Normalized Pokemon-name key: lowercase, diacritics stripped, all
 * non-alphanumerics dropped. Must stay in sync with `normalizePokemonKey` in
 * frontend/src/lib/pokemon-name-resolver.ts.
 */
function normalizePokemonKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export const pokemonRoutes = new Elysia()

  // Pokemon reference data

  .get('/api/pokemon', ({ query }) => {
    const limit = parseInt(query.limit as string) || 100;
    const offset = parseInt(query.offset as string) || 0;
    const search = (query.search as string || '').trim();
    let q = db.select().from(schema.pokemon);
    if (search) {
      const rows = q.all().filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
      return rows.slice(offset, offset + limit);
    }
    return q.limit(limit).offset(offset).all();
  })

  // Exact-name match first; on miss, fall back to a normalized-key match so
  // callers don't have to reproduce the DB's inconsistent punctuation
  // ("Farfetchd-Galar" strips the apostrophe while "Sirfetch'd", "Mr. Mime"
  // and "Type: Null" keep theirs; "Flabebe" drops its accents). Read-only —
  // the 1195-row scan only runs on an exact miss. The frontend resolver
  // (frontend/src/lib/pokemon-name-resolver.ts) mirrors this key.
  .get('/api/pokemon/:name', ({ params }) => {
    const exact = db.select().from(schema.pokemon)
      .where(eq(schema.pokemon.name, params.name))
      .get();
    if (exact) return exact;
    const key = normalizePokemonKey(params.name);
    if (!key) return null;
    return db.select().from(schema.pokemon).all()
      .find(p => normalizePokemonKey(p.name) === key) || null;
  })

  // Move Categories

  .get('/api/move-categories', () => {
    const cats = db.select().from(schema.moveCategories)
      .orderBy(asc(schema.moveCategories.sortOrder))
      .all();

    return cats.map(cat => {
      const entries = db.select().from(schema.moveCategoryEntries)
        .where(eq(schema.moveCategoryEntries.categoryId, cat.id))
        .all();
      return {
        id: cat.id,
        name: cat.name,
        entries: entries.map(e => ({
          id: e.id,
          name: e.name,
          moveId: e.moveId,
          isAbility: e.isAbility,
        })),
      };
    });
  })

  // Tier List

  // Per-cost-format tier list. `?format=` selects the cost sheet (default
  // 'natdexplus'); each format prices/bans species differently (Emerald's
  // 'natdex' bans legendaries/paradoxes and marks up megas/pseudos). Same
  // response shape as before — [{name, tier, status}] — so existing readers
  // that omit the param keep working against the default format.
  .get('/api/tier-list', ({ query }) => {
    const format = (query.format as string)?.trim() || DEFAULT_COST_FORMAT;
    const costs = getFormatCostMap(format);
    return [...costs.entries()]
      // Mirror the legacy filter: drop tier-0 non-banned filler + captain "(T)" rows.
      .filter(([name, c]) => (c.tier > 0 || c.banned || c.teraBanned) && !name.endsWith('(T)'))
      .map(([name, c]) => ({
        name,
        tier: c.tier,
        status: c.banned ? 'banned' as const : c.teraBanned ? 'tera-banned' as const : 'available' as const,
      }))
      .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
  })

  // The cost formats present in the DB, with labels + which leagues use each —
  // powers the admin tier-list editor's format picker.
  .get('/api/cost-formats', () => listCostFormats());
