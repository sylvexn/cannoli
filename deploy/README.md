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
  for private ghcr images was the blocker — host-level `docker login` doesn't
  propagate into Coolify's helper container.

Per-service Dockerfile apps + Coolify-native build server + Docker Hub
(authenticated registry already wired into Coolify on this instance) is the
combo that stays inside Coolify's golden path.

## Going live (the swap)

When the live league opens, run these — order matters:

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

## Initial seeding

Backend containers start with an empty SQLite DB on first deploy.
Seed once via Coolify terminal (or the API exec):

```
# Inside the backend-mock container:
bun run scripts/seed.ts
```

`backend/entrypoint.sh` guards against re-seeding when the DB already exists.

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
