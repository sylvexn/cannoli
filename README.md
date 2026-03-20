# cannoli

pokemon draft tournament league platform — replaces the google sheets + discord workflow with a unified app for drafting, team building, matchup analysis, trading, scouting, and stats.

> **[cannoli.live](https://cannoli.live)** · **[mock.cannoli.live](https://mock.cannoli.live)** (demo with s10 data)

## stack

| layer | tech |
|-------|------|
| runtime | bun |
| frontend | react · vite · tailwind · shadcn/ui |
| backend | elysia · sqlite · drizzle orm |
| auth | httponly cookies · role-based (dev/admin/user) |
| deploy | coolify on vps · dual mode (`live` / `mock`) |

## features

- **multi-league** — 3 concurrent leagues per season, league-scoped routing and data
- **draft board** — grid + table views, filters, live demo mode, sidebar rosters
- **standings** — expandable team rows, k/d records, trade history
- **team profiles** — roster display, defensive profiles, speed tiers, schedules
- **matchup center** — 5-tab workspace with learnsets, team picker, speed analysis
- **trade block** — listings, proposals, transaction history, deadline tracking
- **stats leaderboard** — sortable with mvp medals and filter bar
- **admin panel** — users, leagues, season wizard, tier list, move categories, site settings, activity log
- **tera captains** — cost markup rules, per-league config, tera ban list
