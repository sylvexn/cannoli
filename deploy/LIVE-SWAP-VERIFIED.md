# Live-swap verified runbook delta

Verification pass for launch-prep area #5 (migration + live-swap), run
**2026-05-25** against a locally-built live DB artifact, a locally-started
live-mode backend, and **read-only** Coolify API calls. This file records the
corrections found vs `deploy/README.md`. It does NOT replace that runbook —
read it alongside, applying the deltas marked ⚠️ below.

Everything here was confirmed locally. Nothing was changed on live infra.
Items needing a human to run a write/deploy are called out as **[HUMAN]**.

---

## A. What was verified green

- **Migrations apply from scratch.** All 38 Drizzle migrations (0000..0037)
  apply cleanly to an empty SQLite file and the resulting schema matches
  `src/db/schema.ts` exactly (table set + every column). Test:
  `backend/tests/migrations-from-scratch.test.ts`.
- **Live seed builds the documented artifact.** `CANNOLI_MODE=live bun run
  seed:fresh` produced: seasons `{9 archived, 10 archived}` only; 6 leagues
  (`s9-emerald/ruby/sapphire` + `emerald/ruby/sapphire`) all `offseason`;
  6 finals `completed` + scored; champions emerald=ABS, ruby=VGK,
  sapphire=DWG; trades=0. Verifier: `backend/scripts/verify-live-db.ts`.
- **Probe passes on a live-mode backend.** `scripts/probe-live.sh` → all 8
  checks pass against a local `CANNOLI_MODE=live` backend, including the three
  triple-gate 404s (`/api/admin/sim/state`, `/sim/reset`, `/sim/advance-week`)
  and `/api/auth/demo-session` → 404.
- **Cookie domain confirmed (probe check 8 = MANUAL).** With
  `NODE_ENV=production`, `POST /api/auth/login` sets:
  - `session=…; Domain=.cannoli.live; HttpOnly; SameSite=Lax; Secure`
  - `csrf_token=…; Domain=.cannoli.live; SameSite=Lax; Secure`
  - `sid=…; Domain=.cannoli.live; SameSite=None; Secure` (value URL-encoded —
    commas as `%2C`, so Chrome keeps it)
  The cookie Domain depends on `NODE_ENV=production`, NOT `CANNOLI_MODE` —
  `cannoli-backend-live` already has `NODE_ENV=production`, so this is fine.
- **Coolify topology matches.** All 7 apps, UUIDs, FQDN assignments, build_pack
  (dockerfile), git (`sylvexn/cannoli` @ `master`), and watch_paths match
  `deploy/README.md`, with two minor drifts (see §C).
- **Archive read-only enforcement.** The shared guard
  (`src/lib/archive-guard.ts`) blocks writes on archived seasons across all 4
  lookup variants, honors `?force=1`, and passes through missing rows. Test:
  `backend/tests/archive-enforcement.test.ts`. ~40 route handlers call it.

---

## B. The swap checklist (verified, with deltas)

> Run from a machine with the Coolify token. `deploy/README.md` "Going live"
> has the canonical commands; deltas are flagged ⚠️.

### Pre-swap (do BEFORE touching FQDNs)

1. **[HUMAN] Set the PS internal wiring env vars** — ⚠️ **NOT in the current
   runbook and currently MISSING in Coolify.** Per-league PS chat rooms will
   not materialise without these, and `/api/internal/ps/leagues` refuses all
   requests when the secret is unset:
   - `cannoli-ps-server`: set `CANNOLI_BACKEND_URL=http://cannoli-backend-live:3001`
     and `PS_INTERNAL_SECRET=<shared secret>`.
   - `cannoli-backend-live`: set `PS_INTERNAL_SECRET=<same value>`.
   (Both apps currently have NEITHER key set — verified via the Coolify
   `/envs` API on 2026-05-25.) Generate with `openssl rand -hex 32`.

2. **[HUMAN] Build + verify the live DB artifact** (per `deploy/README.md`
   "Live data migration"), then gate it:
   ```bash
   cd backend
   cp data/cannoli.db /tmp/dev-db.bak                 # preserve dev DB
   rm -f data/cannoli.db-wal data/cannoli.db-shm       # ⚠️ clear stale WAL FIRST
   CANNOLI_MODE=live bun run seed:fresh
   bun -e 'new (require("bun:sqlite").Database)("data/cannoli.db").exec("PRAGMA wal_checkpoint(TRUNCATE)")'
   bun run scripts/verify-live-db.ts data/cannoli.db   # ⚠️ NEW gate — must exit 0
   cp data/cannoli.db /tmp/cannoli-live-built.db
   rm -f data/cannoli.db data/cannoli.db-wal data/cannoli.db-shm
   cp /tmp/dev-db.bak data/cannoli.db                  # restore dev DB (no sidecars!)
   ```
   ⚠️ **Delta vs runbook:** restore ONLY the `.db` file, never the `.db-wal` /
   `.db-shm` sidecars. Restoring a backed-up WAL over a fresh `.db` corrupts it
   (`SQLITE_CORRUPT` / `database disk image is malformed`) and a subsequent
   `seed:fresh` will fail mid-run with cascading FK errors (e.g.
   `mintManualPins` FK failure). Always `rm` the sidecars before/after.

3. **[HUMAN] Ship the artifact** onto `cannoli-live-data` exactly as in
   `deploy/README.md` "Live data migration" steps 3-4 (docker cp through the
   container; clear the WAL sidecars on the volume too). Confirm `RUN_SEED` is
   NOT `1` on `cannoli-backend-live`.

### The swap (order matters — from `deploy/README.md` "Going live")

4. **[HUMAN]** Move FQDN `cannoli.live` → `cannoli-frontend-live`
   (UUID `kovl8psu9d9cpkz13z3b0dkn`). Coolify auto-removes it from
   `cannoli-maintenance`.
5. **[HUMAN]** Repoint the showdown stack at the live backend (keys verified
   correct on 2026-05-25):
   - `cannoli-ps-server` (`g10cjpf53ao0mqs63qtzxn4d`): PATCH env
     `PS_LOGIN_SERVER_URL=http://cannoli-backend-live:3001/api/ps/`
     (currently `…cannoli-backend-mock…`).
   - `cannoli-ps-client` (`idyup5ngjnwlnkzr8bx408q7`): PATCH env
     `PS_LOGIN_HOST=cannoli-backend-live` (currently `cannoli-backend-mock`).
6. **[HUMAN]** Redeploy ps-server, ps-client, and frontend-live
   (`kovl8psu9d9cpkz13z3b0dkn`).
7. **[HUMAN] Verify** with the probe BEFORE deleting maintenance:
   ```bash
   ./scripts/probe-live.sh https://cannoli.live   # must exit 0, mode=live
   ```
   Then manually confirm in DevTools that the `sid` cookie on cannoli.live has
   `Domain=.cannoli.live` (probe check 8 is a manual step — health sets no
   cookie).
8. **[HUMAN]** Delete `cannoli-maintenance` (`mvew9y8klr7lf0s27adjd2vu`).

### Rollback (unchanged from runbook)

Re-create maintenance from `deploy/maintenance/Dockerfile`, move FQDN back,
repoint showdown env to `cannoli-backend-mock`, restore the
`cannoli.db.pre-migration.<ts>` backup over the volume (clear WAL sidecars).

---

## C. Documentation drift vs `deploy/README.md`

| # | Where | Documented | Actual (Coolify API / code, 2026-05-25) | Severity |
|---|---|---|---|---|
| D1 | README §"Required env vars: cannoli-ps-server" | `CANNOLI_BACKEND_URL` + `PS_INTERNAL_SECRET` must be set on ps-server (and `PS_INTERNAL_SECRET` on backend-live) | Neither key is set on `cannoli-ps-server`; `PS_INTERNAL_SECRET` not set on `cannoli-backend-live` either. PS league-room materialisation + `/api/internal/ps/leagues` will be inert. | P1 (config gap) |
| D2 | README §"Backend env reference" line 131-132 | `CANNOLI_DB_PATH` overrides the SQLite path | Dead env var — `backend/src/db/index.ts:7` and `backend/entrypoint.sh:5` BOTH hardcode `…/data/cannoli.db` and never read `CANNOLI_DB_PATH`. (`src/index.ts:33` reads it only for a boot-guard string check.) Harmless because the hardcoded path equals the mount point, but the doc is misleading. | P2 (doc) |
| D3 | README app table, ps-client `Watches` | `showdown/ps-*` (glob) | Explicit files: `showdown/Dockerfile.client`, `showdown/nginx.conf`, `showdown/ps-client-config.js`, `showdown/ps-testclient-key.js`. No `ps-*` glob — a new `showdown/ps-foo.js` would NOT trigger a rebuild. | P2 (doc) |
| D4 | CLAUDE.md "28 tables" | 28 | 29 user tables in `schema.ts` (+`__drizzle_migrations`). | P2 (doc) |
| D5 | README "Going live" rollback | `deploy/maintenance/Dockerfile` | Maintenance app's `dockerfile_location` is `/Dockerfile` with base context, watch_path `deploy/maintenance/**`. File lives at `deploy/maintenance/Dockerfile` (matches), but the build-context/dockerfile path pairing is worth re-confirming before relying on rollback. | P2 (verify) |
