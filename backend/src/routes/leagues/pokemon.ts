import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, sql, asc } from 'drizzle-orm';
import { getFormatCostMap, listCostFormats, DEFAULT_COST_FORMAT } from '../../lib/league-costs';

export const pokemonRoutes = new Elysia()

  // ─── Pokemon reference data ──────────────────────────────────────────

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

  .get('/api/pokemon/:name', ({ params }) => {
    return db.select().from(schema.pokemon)
      .where(eq(schema.pokemon.name, params.name))
      .get() || null;
  })

  // ─── Move Categories ────────────────────────────────────────────────

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

  // ─── Tier List ─────────────────────────────────────────────────────

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
