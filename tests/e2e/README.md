# Cannoli e2e + visual regression

Playwright-based smoke + flow specs that drive the dev server end-to-end.

## First-time setup

```bash
bun add -d @playwright/test
bunx playwright install chromium
```

The `playwright.config.ts` at the repo root spawns the dev backend (`:3001`) and
frontend (`:5173`) before tests, and the global setup hook reseeds the mock DB
via `bun run --cwd backend seed:fresh` so each invocation starts from S10
fixture data.

## Run

```bash
bun run test:e2e          # headless
bun run test:e2e:ui       # Playwright UI for debugging
bun run test:e2e -- -u    # update snapshots
```

## Layout

- `smoke.spec.ts` - sanity: app boots, login page reachable, /health responds
- `profile-colors.spec.ts` - profile-color round-trip
- `__screenshots__/` - visual regression baselines (created on first run)

todo: onboarding, draft (two managers over WS), trade approval, match flow,
league config persistence.
