#!/bin/bash
#
# probe-live.sh — Cannoli live-deployment readiness probe
# =========================================================
#
# USAGE
#   ./scripts/probe-live.sh [BASE_URL]
#   ./scripts/probe-live.sh https://cannoli.live       # default
#   ./scripts/probe-live.sh https://staging.cannoli.live
#
# WHAT THIS CHECKS
#   1. /api/health — HTTP 200, status=ok, mode=live (CRITICAL: mode=mock means
#      the wrong backend container is serving the live domain), db=connected.
#   2. /health     — Elysia root health probe returns 200 {"status":"ok"}.
#   3. /api/seasons — Returns 200 with a non-empty JSON array. The live DB
#      carries archived S9 + S10 data; an empty array means seed did not run.
#   4. /api/admin/sim/state  — Must return 404. This sim route must not be
#      mounted in live mode (mount-time gate layer 1 of the triple-gate).
#   5. /api/admin/sim/reset  — Must return 404 (POST sim route, layer 1+2).
#   6. /api/admin/sim/advance-week — Must return 404 (POST sim route, layer 1+2).
#   7. /api/auth/demo-session — Must return 404. Demo access is mock-only
#      (layer 3 of the triple-gate: hard env check at request time).
#   8. Cookie domain probe — Hits /api/health with -i to capture response
#      headers and reports any Set-Cookie Domain= attribute found. The auth
#      sid cookie must use Domain=.cannoli.live so that SSO spans
#      sim.cannoli.live. This is a MANUAL-CHECK if no Set-Cookie is present
#      on an unauthenticated probe.
#
# CRITICAL MISCONFIGURATION
#   If check 1 reports mode=mock on the live domain (cannoli.live), the live
#   frontend is routing to the mock backend container. Do not launch. Fix the
#   Coolify routing / environment variables before proceeding.
#
# EXIT CODE
#   0 — all checks passed
#   1 — one or more checks failed
#
# ENVIRONMENT
#   NO_COLOR=1  Suppress ANSI color output (set automatically in CI).
#
# ─────────────────────────────────────────────────────────────────────────────

set -u

# ── Argument parsing ──────────────────────────────────────────────────────────

BASE_URL="https://cannoli.live"

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      sed -n '3,50p' "$0"   # print the header comment block
      exit 0
      ;;
    *)
      BASE_URL="$arg"
      ;;
  esac
done

# Strip trailing slash for consistent URL construction
BASE_URL="${BASE_URL%/}"

# ── Color setup ───────────────────────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_PASS='\033[0;32m'
  C_FAIL='\033[0;31m'
  C_WARN='\033[0;33m'
  C_INFO='\033[0;36m'
  C_BOLD='\033[1m'
  C_RESET='\033[0m'
else
  C_PASS=''
  C_FAIL=''
  C_WARN=''
  C_INFO=''
  C_BOLD=''
  C_RESET=''
fi

# ── Counters ──────────────────────────────────────────────────────────────────

PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

pass() {
  PASS=$((PASS + 1))
  printf "${C_PASS}PASS${C_RESET}  %s\n" "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf "${C_FAIL}FAIL${C_RESET}  %s\n" "$1"
}

warn() {
  printf "${C_WARN}WARN${C_RESET}  %s\n" "$1"
}

info() {
  printf "${C_INFO}INFO${C_RESET}  %s\n" "$1"
}

# http_get URL
# Returns: "<status_code> <body>" via stdout (status on first line, body on second)
# Uses a 10-second timeout; body is truncated to 4 KB for display safety.
http_get() {
  local url="$1"
  local out
  out=$(curl --silent --max-time 10 --write-out '\n%{http_code}' "$url" 2>/dev/null)
  local status
  status=$(printf '%s' "$out" | tail -n1)
  local body
  body=$(printf '%s' "$out" | head -c 4096 | head -n -1)
  printf '%s\n%s' "$status" "$body"
}

# http_post URL [json_body]
http_post() {
  local url="$1"
  local body="${2:-{}}"
  local out
  out=$(curl --silent --max-time 10 \
    --request POST \
    --header 'Content-Type: application/json' \
    --data "$body" \
    --write-out '\n%{http_code}' \
    "$url" 2>/dev/null)
  local status
  status=$(printf '%s' "$out" | tail -n1)
  local resp
  resp=$(printf '%s' "$out" | head -c 4096 | head -n -1)
  printf '%s\n%s' "$status" "$resp"
}

# Extract HTTP status (first line) from http_get/http_post output
get_status() {
  printf '%s' "$1" | head -n1
}

# Extract body (everything after the first line) from http_get/http_post output
get_body() {
  printf '%s' "$1" | tail -n +2
}

# ── Banner ────────────────────────────────────────────────────────────────────

printf '\n'
printf "${C_BOLD}Cannoli — Live Deployment Readiness Probe${C_RESET}\n"
printf "${C_BOLD}===========================================${C_RESET}\n"
printf 'Target: %s\n\n' "$BASE_URL"

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1: /api/health — status, mode, db
# ─────────────────────────────────────────────────────────────────────────────

printf "${C_BOLD}[1] /api/health — backend health, mode, db${C_RESET}\n"

raw=$(http_get "${BASE_URL}/api/health")
status=$(get_status "$raw")
body=$(get_body "$raw")

if [ "$status" != "200" ]; then
  fail "/api/health returned HTTP $status (expected 200)"
else
  # status field
  health_status=$(printf '%s' "$body" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"//;s/"//')
  if [ "$health_status" = "ok" ]; then
    pass "/api/health HTTP 200, status=ok"
  else
    fail "/api/health status field is '${health_status}' (expected 'ok')"
  fi

  # mode field — critical check
  health_mode=$(printf '%s' "$body" | grep -o '"mode":"[^"]*"' | head -1 | sed 's/"mode":"//;s/"//')
  if [ "$health_mode" = "live" ]; then
    pass "/api/health mode=live (correct)"
  elif [ "$health_mode" = "mock" ]; then
    fail "/api/health mode=mock — CRITICAL: the live domain is routing to the MOCK backend. Do not launch. Fix Coolify routing / CANNOLI_MODE env var."
  else
    fail "/api/health mode='${health_mode}' — unexpected value (expected 'live')"
  fi

  # db field
  health_db=$(printf '%s' "$body" | grep -o '"db":"[^"]*"' | head -1 | sed 's/"db":"//;s/"//')
  if [ "$health_db" = "connected" ]; then
    pass "/api/health db=connected"
  else
    fail "/api/health db='${health_db}' (expected 'connected') — database may be down or volume not mounted"
  fi
fi

printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2: /health — root health probe
# ─────────────────────────────────────────────────────────────────────────────

printf "${C_BOLD}[2] /health — Elysia root probe${C_RESET}\n"

raw=$(http_get "${BASE_URL}/health")
status=$(get_status "$raw")
body=$(get_body "$raw")

if [ "$status" != "200" ]; then
  fail "/health returned HTTP $status (expected 200)"
else
  root_ok=$(printf '%s' "$body" | grep -c '"ok"' || true)
  if [ "$root_ok" -gt 0 ]; then
    pass "/health HTTP 200 with status ok"
  else
    fail "/health HTTP 200 but body does not contain 'ok' — got: ${body}"
  fi
fi

printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3: /api/seasons — live DB has S9+S10 archived data
# ─────────────────────────────────────────────────────────────────────────────

printf "${C_BOLD}[3] /api/seasons — live DB carries S9+S10 archived season data${C_RESET}\n"

raw=$(http_get "${BASE_URL}/api/seasons")
status=$(get_status "$raw")
body=$(get_body "$raw")

if [ "$status" != "200" ]; then
  fail "/api/seasons returned HTTP $status (expected 200)"
else
  # A non-empty JSON array starts with '[' and is not '[]'
  trimmed=$(printf '%s' "$body" | tr -d '[:space:]')
  if printf '%s' "$trimmed" | grep -q '^\[' && [ "$trimmed" != "[]" ]; then
    pass "/api/seasons HTTP 200 with non-empty season array"
  elif [ "$trimmed" = "[]" ]; then
    fail "/api/seasons returned an empty array — seed-sim or live seed may not have run (expected S9+S10 archived data)"
  else
    fail "/api/seasons response is not a JSON array — got: $(printf '%s' "$body" | head -c 120)"
  fi
fi

printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 4: /api/admin/sim/state — must be 404 (mount-time gate)
# ─────────────────────────────────────────────────────────────────────────────

printf "${C_BOLD}[4] GET /api/admin/sim/state — must 404 (simulator not mounted in live mode)${C_RESET}\n"

raw=$(http_get "${BASE_URL}/api/admin/sim/state")
status=$(get_status "$raw")

if [ "$status" = "404" ]; then
  pass "GET /api/admin/sim/state → 404 (sim route correctly absent)"
elif [ "$status" = "401" ] || [ "$status" = "403" ]; then
  # An auth-gated 401/403 means the route IS mounted — the auth layer fired
  # before the content would be returned. This is still a failure because the
  # route must not exist at all.
  fail "GET /api/admin/sim/state → $status (route is MOUNTED — auth layer responded; sim routes must not be registered in live mode)"
else
  fail "GET /api/admin/sim/state → $status (expected 404 — sim routes must not be mounted in live mode)"
fi

printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 5: POST /api/admin/sim/reset — must be 404
# ─────────────────────────────────────────────────────────────────────────────

printf "${C_BOLD}[5] POST /api/admin/sim/reset — must 404 (layer 1+2 of triple-gate)${C_RESET}\n"

raw=$(http_post "${BASE_URL}/api/admin/sim/reset" '{"confirm":"reset"}')
status=$(get_status "$raw")

if [ "$status" = "404" ]; then
  pass "POST /api/admin/sim/reset → 404 (sim reset correctly gated)"
elif [ "$status" = "401" ] || [ "$status" = "403" ]; then
  fail "POST /api/admin/sim/reset → $status (route is MOUNTED — only auth blocked it; sim routes must not exist in live mode)"
else
  fail "POST /api/admin/sim/reset → $status (expected 404)"
fi

printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 6: POST /api/admin/sim/advance-week — must be 404
# ─────────────────────────────────────────────────────────────────────────────

printf "${C_BOLD}[6] POST /api/admin/sim/advance-week — must 404 (layer 1+2 of triple-gate)${C_RESET}\n"

raw=$(http_post "${BASE_URL}/api/admin/sim/advance-week" '{"leagueId":"probe"}')
status=$(get_status "$raw")

if [ "$status" = "404" ]; then
  pass "POST /api/admin/sim/advance-week → 404 (advance-week correctly gated)"
elif [ "$status" = "401" ] || [ "$status" = "403" ]; then
  fail "POST /api/admin/sim/advance-week → $status (route is MOUNTED — only auth blocked it; sim routes must not exist in live mode)"
else
  fail "POST /api/admin/sim/advance-week → $status (expected 404)"
fi

printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 7: POST /api/auth/demo-session — must be 404 (layer 3: auth gate)
# ─────────────────────────────────────────────────────────────────────────────

printf "${C_BOLD}[7] POST /api/auth/demo-session — must 404 (demo access is mock-only)${C_RESET}\n"

raw=$(http_post "${BASE_URL}/api/auth/demo-session" '{}')
status=$(get_status "$raw")

if [ "$status" = "404" ]; then
  pass "POST /api/auth/demo-session → 404 (demo session correctly blocked in live mode)"
else
  fail "POST /api/auth/demo-session → $status (expected 404 — demo-session must be hard-blocked in live mode; CANNOLI_MODE env var may be missing or wrong)"
fi

printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 8: Cookie domain probe
# ─────────────────────────────────────────────────────────────────────────────
#
# The auth sid cookie must have Domain=.cannoli.live so that SSO spans
# sim.cannoli.live (the Pokemon Showdown client). We hit /api/health with -i
# to capture response headers and grep for Set-Cookie. An unauthenticated
# probe unlikely sets an auth cookie, but the server may set a session or
# CSRF cookie. If no Set-Cookie appears, we emit a MANUAL-CHECK notice.

printf "${C_BOLD}[8] Cookie domain probe — sid / auth cookies must use Domain=.cannoli.live${C_RESET}\n"

headers_raw=$(curl --silent --max-time 10 --include "${BASE_URL}/api/health" 2>/dev/null)
set_cookie_lines=$(printf '%s' "$headers_raw" | grep -i '^set-cookie:' || true)

if [ -z "$set_cookie_lines" ]; then
  warn "No Set-Cookie headers found on unauthenticated GET /api/health"
  info "MANUAL-CHECK required: After logging in as an admin, inspect the browser DevTools"
  info "  Application > Cookies > cannoli.live"
  info "  The 'sid' cookie (and any other auth cookie) MUST have:"
  info "    Domain: .cannoli.live   (leading dot — covers sim.cannoli.live)"
  info "    HttpOnly: true"
  info "    SameSite: Lax"
  info "  Without Domain=.cannoli.live, SSO to sim.cannoli.live will silently fail."
else
  # Check for Domain= attribute in any Set-Cookie line
  domain_lines=$(printf '%s' "$set_cookie_lines" | grep -i 'domain=' || true)
  if [ -n "$domain_lines" ]; then
    # Check specifically for .cannoli.live
    correct=$(printf '%s' "$domain_lines" | grep -i 'domain=\.cannoli\.live' || true)
    if [ -n "$correct" ]; then
      pass "Set-Cookie Domain=.cannoli.live found — SSO subdomain coverage correct"
      info "Cookie header(s): $(printf '%s' "$domain_lines" | head -3)"
    else
      fail "Set-Cookie has Domain= attribute but NOT Domain=.cannoli.live — SSO to sim.cannoli.live may be broken"
      info "Found: $(printf '%s' "$domain_lines" | head -3)"
      info "MANUAL-CHECK: Log in and confirm the 'sid' cookie Domain is '.cannoli.live' in DevTools."
    fi
  else
    warn "Set-Cookie headers present but no Domain= attribute found"
    info "Cookie(s) found: $(printf '%s' "$set_cookie_lines" | head -3)"
    info "MANUAL-CHECK: After logging in, verify in DevTools that the 'sid' cookie has:"
    info "  Domain: .cannoli.live  (required for SSO to sim.cannoli.live)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────

printf '\n'
printf '%s\n' '─────────────────────────────────────────────────────────────────────────────'

TOTAL=$((PASS + FAIL))

if [ "$FAIL" -eq 0 ]; then
  printf "${C_PASS}${C_BOLD}%d passed, %d failed — all checks green. Live deployment looks healthy.${C_RESET}\n" "$PASS" "$FAIL"
else
  printf "${C_FAIL}${C_BOLD}%d passed, %d failed — fix failures before launching.${C_RESET}\n" "$PASS" "$FAIL"
fi

printf '%s\n\n' '─────────────────────────────────────────────────────────────────────────────'

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

exit 0
