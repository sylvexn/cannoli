# backend/scripts

Operational scripts for seeding, importing, and post-processing the Cannoli SQLite DB.

All scripts are Bun-native; run from the `backend/` directory.

## Seed

```sh
bun run seed          # idempotent — bails if seasons already populated
bun run seed:fresh    # wipes data/cannoli.db and re-seeds from scratch
```

`seed.ts` reads two env vars:

- `CANNOLI_MODE` — `mock` (default) or `live`. Mock seeds the active S10 leagues at "finals pending", imports S9 as an archived season, and adds demo trades / activity log / trade-block listings. Live seeds the same shape but skips mock-only fluff.
- `CANNOLI_SEED_SEASON` — `10` (default) or `11`. Selects which season config drives the primary import. Bump when a new season's XLSX files land in `backend/imports/`.

### What "finals pending" means (mock)

- S10 leagues run with `phase = 'playoffs'`, `currentWeek = 11`.
- All regular season + QF + SF matches have results, replays, and per-mon stats.
- The finals match exists with both teams seeded but `home_score` / `away_score` / `replay_url` / `replay_log` cleared and `status = 'scheduled'`.
- The `rewindToFinalsPending` helper in `import-xlsx.ts` runs after the XLSX import to wipe the finals state. Idempotent — safe to re-run.

### S9 archive

- S9 always imports when its three XLSX files are present in `backend/imports/`. The `seasons.archived` flag is flipped on, league IDs are `s9-sapphire` / `s9-ruby` / `s9-emerald`, and per-team `finish_position` / `finish_label` columns get stamped via `assignFinishPositions` so the profile and history surfaces can render finishing badges (Champion / Runner-up / Semifinalist / Quarterfinalist / Regular Season).
- Auto-pin job runs once per S9 league at season-end (idempotent), awarding Cannoli (best regular-season record) and Cynthia (longest streak). Garchomp only awards if S9 has per-mon kill data, which the current XLSX path does not produce.

## Replay archive

The `matches.replay_log` column holds the full PS battle protocol log as JSON; `replay_url` holds the canonical PS replay URL. Two scrapers feed this from external sources:

### `scrape-s10-replays.ts` — official S10 replay site

```sh
bun run scripts/scrape-s10-replays.ts                 # scrape missing
bun run scripts/scrape-s10-replays.ts --force         # re-scrape all
bun run scripts/scrape-s10-replays.ts --league=ruby   # narrow to one league
```

Crawls the canonical S10 archive at `sites.google.com/view/cdl-season-10-replays/...` — that site embeds the full battle-log inline (`<script class="battle-log-data">`), so we never have to round-trip through PS.

Output: `backend/imports/replays/s10/<league>/<phase>/<slug>.json`.

### `scrape-google-sites-replays.ts` — arbitrary Google Sites pages

For Google Sites match pages that just embed PS replays (as `<iframe>`, `<a href>`, or text URLs) instead of inlining the log.

```sh
bun run scripts/scrape-google-sites-replays.ts          # scrape missing
bun run scripts/scrape-google-sites-replays.ts --force  # re-scrape all
```

#### URL list format

Reads from `backend/imports/replays/google-sites-urls.txt`. One entry per line. Three accepted shapes (fields tab- or comma-separated):

```text
# Plain URL — falls back to _unsorted/misc; user must move/rename later
https://sites.google.com/view/example/match-page

# Fully specified — fields: league, phase, slug, url
sapphire    regular/week-3    sas-vs-pow    https://sites.google.com/view/.../sas-vs-pow
ruby        playoffs/sf       m1-vvv-vs-llb https://sites.google.com/view/.../m1-vvv-vs-llb
emerald     playoffs/f        gg-vs-mgm     https://sites.google.com/view/.../gg-vs-mgm

# Comments start with #
```

`league` ∈ { `sapphire`, `ruby`, `emerald` } (anything else dumps under `_unsorted`). `phase` accepts `regular/week-N`, `playoffs/qf`, `playoffs/sf`, `playoffs/f` (or just `qf`/`sf`/`f`). `slug` becomes the JSON filename and seeds `homeAbbrev` / `awayAbbrev` when shaped as `<home>-vs-<away>` (with optional `-ff` suffix on a forfeiting side).

#### Output

Same `MatchRecord` JSON shape as `scrape-s10-replays.ts`, written to `backend/imports/replays/s10/<league>/<phase>/<slug>.json`. Failed URLs are logged to stderr — re-run after fixing the source.

#### Then wire into the DB

```sh
bun run scripts/import-replays.ts
```

`import-replays.ts` walks the cache, finds the matching `matches` row by (league_id, week|playoff_round, home_team_id, away_team_id), and writes `replay_url` + `replay_log`. It's already wired into `seed.ts` for the S10 path, but the standalone runner is the right entry point after a re-scrape.

## Other utilities

- `import-xlsx.ts` — XLSX → DB importer for an active season; exports `importSeason`, `rewindToFinalsPending`, `assignFinishPositions`, and the per-season configs.
- `import-s9.ts` — S9-specific XLSX importer (S9 has a different sheet layout from S10, prefixes its league IDs with `s9-`).
- `sync-team-colors.ts` — re-reads team colors from the styled XLSX when only `team_color` drifted.
