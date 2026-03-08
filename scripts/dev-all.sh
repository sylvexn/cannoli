#!/bin/bash
#
# Start all dev services: frontend, backend, PS server, PS client.
# Run: bun dev (or bun run dev:all)
#
CANNOLI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SHOWDOWN_DIR="$CANNOLI_DIR/showdown"

# Load .env into current shell
if [ -f "$CANNOLI_DIR/.env" ]; then
  set -a
  source "$CANNOLI_DIR/.env"
  set +a
fi

# Check if Showdown is set up
if [ ! -d "$SHOWDOWN_DIR/server" ]; then
  echo "Showdown not set up. Run: bun run setup:showdown"
  echo "Starting without Showdown services..."
  echo ""
  HAS_SHOWDOWN=false
else
  HAS_SHOWDOWN=true
fi

# Trap to kill all background processes on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $(jobs -p) 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "=== Cannoli Dev ==="
echo ""

# ─── Backend ──────────────────────────────────────────────────────────────────
echo "[backend]  http://localhost:3001"
cd "$CANNOLI_DIR/backend"
bun run --hot src/index.ts &

# ─── Frontend ─────────────────────────────────────────────────────────────────
echo "[frontend] http://localhost:5173"
cd "$CANNOLI_DIR/frontend"
bun run vite &

if [ "$HAS_SHOWDOWN" = true ]; then
  # ─── PS Game Server ───────────────────────────────────────────────────────
  echo "[ps-server] ws://localhost:8000"
  cd "$SHOWDOWN_DIR/server"
  node pokemon-showdown start --no-security &

  # ─── PS Client ────────────────────────────────────────────────────────────
  echo "[ps-client] http://localhost:8080"
  cd "$SHOWDOWN_DIR/client/play.pokemonshowdown.com"
  bunx http-server -p 8080 -s &
fi

echo ""
echo "All services running. Ctrl+C to stop."
echo ""

# Wait for any process to exit
wait
