#!/usr/bin/env bash
#
# Gated, staggered deploy of affected Cannoli apps.
#
# Invoked by .github/workflows/ci.yml's `deploy` job, which runs ONLY after the
# fast-checks gate is green and ONLY on pushes to master. Replaces Coolify's
# raw git-webhook auto-deploy so that:
#   1. broken master never ships (the gate is upstream of this script),
#   2. apps deploy ONE AT A TIME (no concurrent-build fan-out that hangs the vps),
#   3. each deploy is verified up (backends: exact commit; frontends: 200) before
#      the next is triggered — and the job goes red + alerts if one never comes up.
#
# It still reproduces Coolify's per-app `watch_paths` selectivity from the diff,
# so a frontend-only push won't rebuild backends, etc. From your side the flow is
# unchanged: `git push` → site updates. This just sits in the middle, gating it.
#
# Required env (GitHub Actions secrets):
#   COOLIFY_URL    e.g. https://cool.syl.rest
#   COOLIFY_TOKEN  Coolify API token (account api-key)
# Optional:
#   DISCORD_WEBHOOK  posts a one-line alert if a deploy fails to come up
#   SHA              full commit (defaults to HEAD); BEFORE = previous pushed sha
set -uo pipefail

DRY_RUN="${DRY_RUN:-0}"   # =1 prints the deploy plan and exits without calling Coolify
if [ "$DRY_RUN" != 1 ]; then
  : "${COOLIFY_URL:?COOLIFY_URL is required}"
  : "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"
fi
COOLIFY_URL="${COOLIFY_URL:-}"
COOLIFY_TOKEN="${COOLIFY_TOKEN:-}"
SHA="${SHA:-$(git rev-parse HEAD)}"
SHORT="${SHA:0:12}"
BEFORE="${BEFORE:-}"
DISCORD_WEBHOOK="${DISCORD_WEBHOOK:-}"

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-900}"   # 15 min — covers build-on-construct + pull + restart
POLL_INTERVAL=15
WEB_SETTLE=90                              # frontends serve 200 with the OLD build mid-deploy; settle first

log()  { printf '%s\n' "$*"; }
group(){ printf '::group::%s\n' "$*"; }
endgroup(){ printf '::endgroup::\n'; }

alert() {
  [ -n "$DISCORD_WEBHOOK" ] || return 0
  local msg="$1"
  curl -sf --max-time 10 -X POST "$DISCORD_WEBHOOK" \
    -H 'Content-Type: application/json' \
    -d "{\"content\":\"[ci/deploy] ${msg} — commit ${SHORT} — ${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}\"}" \
    >/dev/null 2>&1 || true
}

# ── 1. Changed files ────────────────────────────────────────────────────────
CHANGED="${CHANGED:-}"   # pre-settable for testing; otherwise derived from the diff
if [ -n "$CHANGED" ]; then
  : # use the provided list
elif [ -n "$BEFORE" ] && [ "$BEFORE" != "0000000000000000000000000000000000000000" ] \
   && git cat-file -e "${BEFORE}^{commit}" 2>/dev/null; then
  CHANGED="$(git diff --name-only "$BEFORE" "$SHA")"
elif git rev-parse HEAD~1 >/dev/null 2>&1; then
  CHANGED="$(git diff --name-only HEAD~1 HEAD)"
else
  CHANGED="__ALL__"   # first commit / shallow history we can't diff: deploy everything
fi
log "Changed files:"; printf '  %s\n' $CHANGED

match() { [ "$CHANGED" = "__ALL__" ] && return 0; printf '%s\n' "$CHANGED" | grep -Eq "$1"; }

# Shared deps rebuild everything that runs bun (mirrors Coolify watch_paths).
deps=false; match '^(package\.json|bun\.lock)$' && deps=true

backend=false;  { $deps || match '^backend/'; }  && backend=true
frontend=false; { $deps || match '^frontend/'; } && frontend=true
psserver=false; match '^(showdown/Dockerfile\.server|ps/)' && psserver=true
psclient=false; match '^showdown/(Dockerfile\.client|nginx\.conf|ps-client-config\.js|ps-testclient-key\.js)' && psclient=true

# ── 2. Build the ordered deploy plan ────────────────────────────────────────
# Order = LIVE first (prod is the priority — git push should land on cannoli.live
# ASAP), then mock; backend before its frontend within each. The fast-checks gate
# (lint/type/unit, which boots the backend in tests) is the pre-deploy safety net.
# Fields: name|uuid|kind|url   kind ∈ {backend,web,internal}
PLAN=()
$backend  && PLAN+=("cannoli-backend-live|akbbnhszn7nvyyvjo641w6k5|backend|https://cannoli.live/api/health")
$frontend && PLAN+=("cannoli-frontend-live|kovl8psu9d9cpkz13z3b0dkn|web|https://cannoli.live")
$backend  && PLAN+=("cannoli-backend-mock|bg57felkp9yhq663xr9zn4ry|backend|https://mock.cannoli.live/api/health")
$frontend && PLAN+=("cannoli-frontend-mock|ikfwnq7d8f0g9yqlu83qb18r|web|https://mock.cannoli.live")
$psserver && PLAN+=("cannoli-ps-server|g10cjpf53ao0mqs63qtzxn4d|internal|-")
$psclient && PLAN+=("cannoli-ps-client|idyup5ngjnwlnkzr8bx408q7|web|https://sim.cannoli.live")
# cannoli-maintenance is intentionally omitted — cannoli.live is live, the
# maintenance app is deleted. Re-add it here if you ever roll back to it.

if [ ${#PLAN[@]} -eq 0 ]; then
  log "No deployable paths changed — nothing to do."
  exit 0
fi

log ""; log "Deploy plan (${#PLAN[@]} app(s), sequential):"
for e in "${PLAN[@]}"; do log "  - ${e%%|*}"; done

if [ "$DRY_RUN" = 1 ]; then log ""; log "DRY_RUN=1 — not triggering Coolify."; exit 0; fi

# ── 3. Health probes ────────────────────────────────────────────────────────
wait_for_version() {   # backend: poll /api/health until version == SHORT
  local url="$1" deadline=$(( $(date +%s) + HEALTH_TIMEOUT )) got
  log "Waiting for $url to report version=$SHORT ..."
  while [ "$(date +%s)" -lt "$deadline" ]; do
    got="$(curl -sf --max-time 10 "$url" 2>/dev/null | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)"
    if [ "$got" = "$SHORT" ]; then log "  up: version=$got"; return 0; fi
    log "  current=${got:-<none>} want=$SHORT — retrying in ${POLL_INTERVAL}s"
    sleep "$POLL_INTERVAL"
  done
  return 1
}

wait_for_200() {       # frontend: settle, then poll root for 200
  local url="$1" deadline code
  log "Settling ${WEB_SETTLE}s before probing $url ..."; sleep "$WEB_SETTLE"
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null)"
    if [ "$code" = "200" ]; then log "  up: HTTP 200"; return 0; fi
    log "  code=${code:-<none>} — retrying in ${POLL_INTERVAL}s"
    sleep "$POLL_INTERVAL"
  done
  return 1
}

# ── 4. Trigger + verify, one at a time ──────────────────────────────────────
trigger() {            # POST Coolify deploy for one app uuid
  local uuid="$1"
  curl -sf --max-time 30 -X POST \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    "$COOLIFY_URL/api/v1/deploy?uuid=$uuid" >/dev/null
}

failed=()
for entry in "${PLAN[@]}"; do
  IFS='|' read -r name uuid kind url <<< "$entry"
  group "Deploy $name"
  log "Triggering Coolify deploy ($uuid)"
  if ! trigger "$uuid"; then
    log "ERROR: deploy trigger failed for $name"
    failed+=("$name (trigger)"); endgroup; continue
  fi

  ok=0
  case "$kind" in
    backend)  wait_for_version "$url" && ok=1 ;;
    web)      wait_for_200 "$url" && ok=1 ;;
    internal) log "No public health endpoint; settling ${WEB_SETTLE}s"; sleep "$WEB_SETTLE"; ok=1 ;;
  esac

  if [ "$ok" = 1 ]; then
    log "OK: $name is live on $SHORT"
  else
    log "ERROR: $name did not come up healthy within ${HEALTH_TIMEOUT}s"
    failed+=("$name (health)")
  fi
  endgroup
done

# ── 5. Verdict ──────────────────────────────────────────────────────────────
if [ ${#failed[@]} -ne 0 ]; then
  log ""; log "Deploy FAILED for: ${failed[*]}"
  alert "deploy did NOT come up healthy: ${failed[*]}. Roll back in Coolify (redeploy previous) if needed."
  exit 1
fi
log ""; log "All ${#PLAN[@]} app(s) deployed and verified on $SHORT."
