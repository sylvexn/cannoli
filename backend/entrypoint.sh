#!/bin/sh
set -e

# Seed the DB only on first boot (no existing file) or when explicitly requested.
# Honor CANNOLI_DB_PATH (read by the backend at runtime — src/db/index.ts) so
# the seed gate checks the same file the server will actually open; fall back
# to the canonical volume path otherwise.
DB_PATH="${CANNOLI_DB_PATH:-/app/backend/data/cannoli.db}"

# Pick the seed by deployment mode: mock runs the synthetic season simulator
# (seed-sim.ts), every other mode runs the real XLSX-import seed (seed.ts).
if [ "$CANNOLI_MODE" = "mock" ]; then
  SEED_SCRIPT="scripts/seed-sim.ts"
else
  SEED_SCRIPT="scripts/seed.ts"
fi

if [ "$RUN_SEED" = "1" ] || [ ! -f "$DB_PATH" ]; then
  echo "[entrypoint] seeding database via $SEED_SCRIPT (RUN_SEED=$RUN_SEED, db_exists=$([ -f "$DB_PATH" ] && echo yes || echo no))"
  bun run "$SEED_SCRIPT"
else
  echo "[entrypoint] db exists at $DB_PATH, skipping seed"
fi

exec bun run src/index.ts
