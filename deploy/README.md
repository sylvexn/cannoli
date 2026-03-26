# Cannoli deployment

Coolify on `cool.syl.rest` orchestrates 7 dockerfile-buildpack apps in the
`cannoli` project. Builds run on the `construct` build server (over SSH);
the production vps only pulls the resulting layer and runs containers.

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
2. Coolify webhook fires; `watch_paths` filters which apps redeploy.
3. Coolify SSHes to `construct`, builds the image there.
4. Image transferred to vps via `docker save | docker load` over SSH.
5. Container restarted on vps.

vps does **zero** build CPU.

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
