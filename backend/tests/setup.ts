/**
 * Test preload — runs once before any test file (registered in bunfig.toml
 * `[test].preload`).
 *
 * Many suites (draft-timer, pins-uniqueness, draft-reconnect, trade-validation,
 * season-lifecycle, …) need the ~1200-row `pokemon` reference table to exist:
 * fixtures pull a real mon by tier via `pickByTier`. Locally that table is
 * present because the dev DB was seeded from the XLSX. In CI the checkout has no
 * DB and no XLSX, so the table is created empty by the migration chain and those
 * tests throw "no seeded tier-N pokemon available".
 *
 * This preload backfills the reference table from a committed JSON fixture ONLY
 * when it is empty (see `ensurePokemonReference`). Note this once-at-preload seed
 * is NOT sufficient on its own: an order-dependent reset in another suite can
 * empty the table mid-run, so `pickByTier` re-seeds defensively too.
 */
import { ensurePokemonReference } from './pokemon-reference-seed';

ensurePokemonReference();
