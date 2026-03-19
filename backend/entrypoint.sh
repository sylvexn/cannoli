#!/bin/sh
set -e

# Seed the DB only on first boot (no existing file) or when explicitly requested.
DB_PATH="/app/backend/data/cannoli.db"

if [ "$RUN_SEED" = "1" ] || [ ! -f "$DB_PATH" ]; then
  echo "[entrypoint] seeding database (RUN_SEED=$RUN_SEED, db_exists=$([ -f "$DB_PATH" ] && echo yes || echo no))"
  bun run scripts/seed.ts
else
  echo "[entrypoint] db exists at $DB_PATH, skipping seed"
fi

exec bun run src/index.ts
