/**
 * add-move-categories.ts — ensure the "Disruption" and "HP Cutting" move
 * categories exist in the matchup-center move grid (feedback #43: users
 * couldn't see who runs Knock Off and similar disruption moves because no
 * such category was configured on live).
 *
 * Move categories are admin-managed DB rows, so this can't ship in code — it
 * runs against the live DB exactly like the admin "add category / add entry"
 * actions (mirrors POST /api/move-categories + /:id/entries in
 * src/routes/admin/config.ts). Idempotent: skips categories/entries that
 * already exist, so re-running is safe.
 *
 *   bun run scripts/add-move-categories.ts            # dry-run (show plan)
 *   bun run scripts/add-move-categories.ts --apply    # write
 */
import { db, schema } from '../src/db';
import { eq, and, sql } from 'drizzle-orm';

const APPLY = process.argv.includes('--apply');

/** Same slug/id derivation the admin endpoints use. */
const catId = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');
const moveId = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

// Move sets mirror the canonical DEFAULT_MOVE_CATEGORIES in the frontend.
const CATEGORIES: { name: string; moves: string[] }[] = [
  {
    name: 'Disruption',
    moves: [
      'Taunt', 'Knock Off', 'Encore', 'Trick', 'Switcheroo', 'Thief',
      'Psychic Noise', 'Covet', 'Corrosive Gas', 'Soak', 'Worry Seed',
      'Entrainment', 'Skill Swap', 'Simple Beam', 'Imprison',
    ],
  },
  {
    name: 'HP Cutting',
    moves: [
      'Pain Split', 'Endeavor', 'Super Fang', 'Seismic Toss', 'Final Gambit',
      'Night Shade', 'Psywave', 'Dragon Rage', 'Sonic Boom',
    ],
  },
];

function run() {
  let nextSort = (db.select({ max: sql<number>`MAX(sort_order)` })
    .from(schema.moveCategories).get()?.max ?? 0);

  for (const cat of CATEGORIES) {
    const id = catId(cat.name);
    const existing = db.select().from(schema.moveCategories)
      .where(eq(schema.moveCategories.id, id)).get();

    if (!existing) {
      nextSort += 1;
      console.log(`+ category "${cat.name}" (id=${id}, sortOrder=${nextSort})`);
      if (APPLY) {
        db.insert(schema.moveCategories)
          .values({ id, name: cat.name, sortOrder: nextSort }).run();
      }
    } else {
      console.log(`= category "${cat.name}" already exists (id=${id})`);
    }

    for (const move of cat.moves) {
      const mid = moveId(move);
      const hasEntry = db.select().from(schema.moveCategoryEntries)
        .where(and(
          eq(schema.moveCategoryEntries.categoryId, id),
          eq(schema.moveCategoryEntries.moveId, mid),
        )).get();
      if (hasEntry) {
        console.log(`    = ${move} (already in category)`);
        continue;
      }
      console.log(`    + ${move} (moveId=${mid})`);
      if (APPLY) {
        db.insert(schema.moveCategoryEntries).values({
          categoryId: id,
          name: move,
          moveId: mid,
          isAbility: false,
        }).run();
      }
    }
  }

  if (APPLY) {
    db.insert(schema.activityLog).values({
      type: 'move_category_created',
      category: 'config',
      actor: 'script:add-move-categories',
      leagueId: null,
      description: 'Added Disruption + HP Cutting move categories',
      metadata: JSON.stringify({ categories: CATEGORIES.map(c => c.name) }),
    }).run();
    console.log('\nApplied.');
  } else {
    console.log('\nDry run — re-run with --apply to write.');
  }
}

run();
