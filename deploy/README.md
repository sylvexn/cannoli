# Cannoli deployment

Coolify on `cool.syl.rest` orchestrates 7 dockerfile-buildpack apps in the
`cannoli` project. Builds run on the `construct` build server; the
production vps only pulls finished images from a registry and runs them.

## Network topology

```
                                                        ┌─────────────────────┐
   git push (master)  ──►  github webhook  ──►  Coolify │  cool.syl.rest      │
                                                        │  (Coolify control)  │
                                                        └──────────┬──────────┘
                                                                   │
                            ssh build job                          │ ssh deploy job
                                  ▼                                ▼
                       ┌───────────────────┐              ┌───────────────────┐
                       │  construct        │              │  vps              │
                       │  100.126.76.123   │              │  Tailscale: vps   │
                       │  (build server)   │              │  prod containers  │
                       │                   │              │                   │
                       │  docker build     │              │  docker pull      │
                       │  docker push  ────┼──► ghcr/dockerhub ◄── docker pull│
                       │  sylvexnn/c-*     │  registry    │  (rolling restart)│
                       └───────────────────┘              └───────────────────┘
                                                                   │
                                                                   │ all 7 containers
                                                                   ▼
                                                          ┌─────────────────────┐
                                                          │ docker bridge       │
                                                          │ network: `coolify`  │
                                                          │ 10.0.1.0/24         │
                                                          │                     │
                                                          │ network aliases:    │
                                                          │   cannoli-backend-mock
                                                          │   cannoli-backend-live
                                                          │   cannoli-frontend-*
                                                          │   cannoli-ps-server │
                                                          │   cannoli-ps-client │
                                                          │   cannoli-maintenance
                                                          └─────────────────────┘
```

- **Public ingress** is Coolify's Traefik on the vps, routing FQDNs to the right container.
- **Cross-app traffic** uses the shared `coolify` docker network with stable aliases
  (e.g. nginx in `cannoli-frontend-mock` proxies `/api` → `http://cannoli-backend-mock:3001`).
- **Aliases never change** even if a container is recreated, so config can hard-code them.

## Apps

| App | FQDN | Watches | Notes |
|---|---|---|---|
| `cannoli-backend-mock` | (internal: `cannoli-backend-mock:3001`) | `backend/**`, `package.json`, `bun.lock` | Active mock backend. SQLite on `cannoli-mock-data` volume. |
| `cannoli-frontend-mock` | `mock.cannoli.live` | `frontend/**`, `package.json`, `bun.lock` | nginx, proxies `/api` → `cannoli-backend-mock`. |
| `cannoli-ps-server` | (internal: `cannoli-ps-server:8000`) | `showdown/Dockerfile.server`, `ps/**` | PS game server. Logs + replays on `ps-logs` / `ps-databases` volumes. |
| `cannoli-ps-client` | `sim.cannoli.live` | `showdown/Dockerfile.client`, `showdown/nginx.conf`, `showdown/ps-*` | PS client. `PS_LOGIN_HOST` env points at the active backend. |
| `cannoli-maintenance` | `cannoli.live` | `deploy/maintenance/**` | Under-construction page. Replaced when launching live. |
| `cannoli-backend-live` | (dormant, internal alias `cannoli-backend-live`) | `backend/**`, `package.json`, `bun.lock` | DORMANT. Auto-builds + runs alongside mock with own DB volume so it stays warm. No FQDN. |
| `cannoli-frontend-live` | (dormant, no FQDN) | `frontend/**`, `package.json`, `bun.lock` | DORMANT. Auto-builds. Activated by assigning `cannoli.live`. |

## Deploy flow

1. Push to `master`.
2. Coolify GitHub webhook fires; `watch_paths` filters which apps redeploy.
3. For each affected app: Coolify SSHes to `construct`, runs `docker build`,
   then `docker push sylvexnn/c-<service>:<commit-sha>` to Docker Hub.
4. Coolify SSHes to vps, runs `docker pull sylvexnn/c-<service>:<commit-sha>`.
5. Coolify rolling-restarts the container on vps.

vps does **zero** build CPU. construct handles all builds; the registry
(Docker Hub `sylvexnn` org) is the transfer medium.

### Why this shape (history)

We tried two architectures before settling here:

- **Docker Compose stacks** (consolidated 4-service mock+live+showdown): Coolify
  v4's compose buildpack does **not** support build servers (gated in the source:
  `@if ($buildPack !== 'dockercompose')`, see [discussion #3221](https://github.com/coollabsio/coolify/discussions/3221)).
  Builds had to run on vps; the bun + vite + rolldown chain crashed it under
  Coolify's default `concurrent_builds=2` cascade.
- **GitHub Actions → ghcr.io → Coolify pull**: works for the build-offload, but
  Coolify v4 has no "Private Docker Registries" UI for external registries
  (issue [#6364](https://github.com/coollabsio/coolify/issues/6364)). Pull auth
  for private ghcr images was the blocker - host-level `docker login` doesn't
  propagate into Coolify's helper container.

Per-service Dockerfile apps + Coolify-native build server + Docker Hub
(authenticated registry already wired into Coolify on this instance) is the
combo that stays inside Coolify's golden path.

## Going live (the swap)

When the live league opens, run these - order matters:

```bash
# 1. Move FQDN: cannoli.live → cannoli-frontend-live
#    (Coolify UI: cannoli-frontend-live → General → Domains → set https://cannoli.live)
#    Coolify auto-removes it from cannoli-maintenance.

# 2. Repoint the showdown stack at the live backend
COOLIFY_URL=https://cool.syl.rest
TOKEN=<your token>
PS_SERVER=g10cjpf53ao0mqs63qtzxn4d
PS_CLIENT=idyup5ngjnwlnkzr8bx408q7
# PS server uses PS_LOGIN_SERVER_URL; PS client uses PS_LOGIN_HOST
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"PS_LOGIN_SERVER_URL","value":"http://cannoli-backend-live:3001/api/ps/","is_preview":false}' \
  "$COOLIFY_URL/api/v1/applications/$PS_SERVER/envs"
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"PS_LOGIN_HOST","value":"cannoli-backend-live","is_preview":false}' \
  "$COOLIFY_URL/api/v1/applications/$PS_CLIENT/envs"

# 3. Redeploy the affected apps so envs/FQDNs take effect:
for u in $PS_SERVER $PS_CLIENT kovl8psu9d9cpkz13z3b0dkn ; do
  curl -X POST -H "Authorization: Bearer $TOKEN" "$COOLIFY_URL/api/v1/deploy?uuid=$u"
done

# 4. Once verified, delete cannoli-maintenance:
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "$COOLIFY_URL/api/v1/applications/mvew9y8klr7lf0s27adjd2vu"
```

To roll back: re-create maintenance from `deploy/maintenance/Dockerfile`,
move FQDN back, repoint showdown env to `cannoli-backend-mock`.

## Backend env reference

Selected env vars consumed by the backend container (full list in
`backend/src/index.ts` boot guards):

- `CANNOLI_MODE` - `mock` | `live` (per-deployment).
- `CANNOLI_DB_PATH` - override SQLite path (defaults to `backend/data/cannoli.db`).
- `PS_SERVER_WS_URL` - bot connects here. Unset = bot disabled.
- `PS_RSA_PRIVATE_KEY` - required when `PS_SERVER_WS_URL` is set; signs PS auth assertions.
- `PS_INTERNAL_SECRET` - shared secret gating `/api/internal/ps/leagues`. Must match
  the value set on `cannoli-ps-server` (the PS startup hook calls this endpoint to
  materialise per-league chat rooms). Generate with `openssl rand -hex 32`.
- `PS_LOGS_DIR` - root for PS autosaved replay logs (`{format}/{YYYY-MM-DD}/{roomId}.log.json`).
  Used by the disk-replay fallback when the bot was offline at the moment a match
  finished. Defaults to `./showdown/server/logs` (in-repo PS checkout). In production
  point at the mounted `ps-logs` volume - the same volume `cannoli-ps-server` writes to,
  mounted read-only into `cannoli-backend-{mock,live}`.
- `BOT_USERNAME` / `BOT_PASSWORD` - credentials for the bot's `users` row, seeded
  on every boot when bot env is set.

## Required env vars: cannoli-ps-server

The PS server's startup hook (`ps/config-example.js`) fetches active leagues
from the backend so it can spin up matching chat rooms. Set these in Coolify
on `cannoli-ps-server` before deploying the SSO-roles changes:

- `CANNOLI_BACKEND_URL` - internal docker alias for the active backend.
  - mock: `http://cannoli-backend-mock:3001`
  - live: `http://cannoli-backend-live:3001`
- `PS_INTERNAL_SECRET` - same value as on `cannoli-backend-{mock,live}`.

Additionally, the SSO assertion now carries `s1` (role) / `s2` (league slugs) /
`s3` (reserved). PS picks them up automatically — no PS-side config needed for
that part. Coaches get `+` globally + `%` in their league rooms; admins get `~`.
The `cannoli-roles` plugin only ever auto-promotes; it never demotes, so any
hand-promoted staff above this baseline keep their rank.

## Initial seeding

Backend containers start with an empty SQLite DB on first deploy.
`backend/entrypoint.sh` runs `scripts/seed-sim.ts` automatically (via
`bun run seed:sim`) when the DB file is missing (or when `RUN_SEED=1`), and
skips it once a DB exists.

- **mock** — `CANNOLI_MODE=mock`. Seeds the **synthetic-season simulator**: two
  fictional seasons (one finished, one mid-season), 3 gem leagues each, 12 teams
  per league, full drafted rosters, complete regular-season results, and a
  finished playoff bracket for season 1. Data is entirely fictional — no real
  coaches or teams. The seed is deterministic (`masterSeed=0xcafe`). Run locally
  with `bun run seed:sim` from `backend/`. Design record: `plan/simulator.md`.
  - `/api/admin/sim/*` — simulator control API, **mock-only** (404 in live).
  - `POST /api/auth/demo-session` — creates a no-password demo admin session,
    **mock-only** (404 in live). Used by the public-facing simulator panel.
- **live** — does **not** self-seed in place. The live DB is built locally and
  shipped onto the volume — see the migration runbook below.

## Live data migration (S9 + S10 → live DB)

The live database is built locally and copied onto the `cannoli-live-data`
volume, rather than seeded inside the container. This keeps the heavy XLSX
import + replay scrape off the vps and lets the artifact be verified before it
goes live.

```bash
# 1. Build the live DB locally (S9 archived + S10 finalized & archived, no
#    mock data; S11 is NOT created — it launches separately on launch day).
cd backend
cp data/cannoli.db /tmp/dev-db.bak                  # preserve dev DB
CANNOLI_MODE=live bun run seed:fresh
bun -e 'new (require("bun:sqlite").Database)("data/cannoli.db").exec("PRAGMA wal_checkpoint(TRUNCATE)")'
cp data/cannoli.db /tmp/cannoli-live-built.db        # the artifact to ship
cp /tmp/dev-db.bak data/cannoli.db                   # restore dev DB

# 2. Verify the artifact: seasons = {9 archived, 10 archived} only; 6 leagues
#    (3 s9-* + 3 S10) all offseason; 6 finals completed+scored; champions
#    emerald-abs / ruby-vgk / sapphire-dwg; trades = 0.

# 3. Ship it. The live volume is root-owned on the host, so work through the
#    container ($C = <live-backend-uuid>-<deployment-id>, see `docker ps`).
C=$(ssh vps "docker ps --format '{{.Names}}' | grep '^akbbnhszn7nvyyvjo641w6k5-'")
ssh vps "docker exec $C sh -c 'cd /app/backend/data && cp cannoli.db cannoli.db.pre-migration.\$(date +%Y%m%d-%H%M%S)'"
ssh vps "docker stop $C"
scp /tmp/cannoli-live-built.db vps:/tmp/ && touch /tmp/empty && scp /tmp/empty vps:/tmp/empty
ssh vps "docker cp /tmp/cannoli-live-built.db $C:/app/backend/data/cannoli.db && \
         docker cp /tmp/empty $C:/app/backend/data/cannoli.db-wal && \
         docker cp /tmp/empty $C:/app/backend/data/cannoli.db-shm"   # clear stale WAL sidecars
ssh vps "docker start $C"

# 4. Verify the running container logs '[entrypoint] db exists ... skipping
#    seed' and /api/health reports {"mode":"live","db":"connected"}, and
#    /api/seasons returns S9 + S10 both archived.
```

**Rollback:** stop the container, `docker cp` the `cannoli.db.pre-migration.<ts>`
backup (kept in the volume) back over `cannoli.db`, clear the WAL sidecars, start.
`RUN_SEED` must **not** be `1` on `cannoli-backend-live`, or the entrypoint will
wipe the shipped DB on next boot.

## VPS access

- SSH host alias `vps` (Tailscale `100.97.127.36`) is configured in
  `~/.ssh/config`; key `~/.ssh/id_ed25519`. Docker is usable as the `syl` user
  without sudo (sudo itself needs a password — file ops on root-owned volume
  dirs must go through `docker exec` / `docker cp`).
- Coolify containers are named `<app-uuid>-<deployment-id>`; resolve the current
  name with `docker ps --format '{{.Names}}' | grep '^<app-uuid>-'`.
- Live DB volume: `akbbnhszn7nvyyvjo641w6k5-cannoli-live-data`, host path
  `/var/lib/docker/volumes/akbbnhszn7nvyyvjo641w6k5-cannoli-live-data/_data`
  (root-owned), mounted at `/app/backend/data` in `cannoli-backend-live`.

## App UUIDs (current)

```
cannoli-backend-mock    bg57felkp9yhq663xr9zn4ry
cannoli-frontend-mock   ikfwnq7d8f0g9yqlu83qb18r
cannoli-ps-server       g10cjpf53ao0mqs63qtzxn4d
cannoli-ps-client       idyup5ngjnwlnkzr8bx408q7
cannoli-maintenance     mvew9y8klr7lf0s27adjd2vu
cannoli-backend-live    akbbnhszn7nvyyvjo641w6k5  (dormant)
cannoli-frontend-live   kovl8psu9d9cpkz13z3b0dkn  (dormant)
```
