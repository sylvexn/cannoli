import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, sql, asc, desc } from 'drizzle-orm';

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

  .get('/api/tier-list', () => {
    return db.select({
      name: schema.pokemon.name,
      tier: schema.pokemon.tier,
      teraBanned: schema.pokemon.teraBanned,
      banned: schema.pokemon.banned,
    }).from(schema.pokemon)
      .where(sql`(${schema.pokemon.tier} > 0 OR ${schema.pokemon.banned} = 1 OR ${schema.pokemon.teraBanned} = 1) AND ${schema.pokemon.name} NOT LIKE '%(T)'`)
      .orderBy(desc(schema.pokemon.tier), asc(schema.pokemon.name))
      .all()
      .map(p => ({
        name: p.name,
        tier: p.tier,
        status: p.banned ? 'banned' as const : p.teraBanned ? 'tera-banned' as const : 'available' as const,
      }));
  });
