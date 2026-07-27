#!/usr/bin/env bash
#
# One-command bot end-to-end validation: stands up the PS server (if not already
# running), then runs the harness (which boots the backend + in-process bot and
# drives two scripted PS clients through a forfeit and a real-move battle).
#
#   bash backend/scripts/bot-e2e/run.sh
#
# Prereq: scripts/setup-showdown.sh has been run once (clones + builds PS,
# generates showdown/ps_private.pem, writes .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PS_DIR="$ROOT/showdown/server"
DB="${CANNOLI_DB_PATH:-/tmp/bot-e2e.db}"

if ! curl -s -m2 http://localhost:8000/ -o /dev/null; then
  echo "[run.sh] starting PS server on :8000 …"
  ( cd "$PS_DIR" && setsid node pokemon-showdown start --no-security > /tmp/ps-server.log 2>&1 < /dev/null & disown )
  for i in $(seq 1 20); do curl -s -m2 http://localhost:8000/ -o /dev/null && break; sleep 1; done
  echo "[run.sh] PS server up"
else
  echo "[run.sh] PS server already running"
fi

cd "$ROOT/backend"
CANNOLI_DB_PATH="$DB" bun run scripts/bot-e2e/run.ts
