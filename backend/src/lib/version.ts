/**
 * Build/release identity. Coolify injects the deploy commit as a *runtime* env
 * var `SOURCE_COMMIT` (a build arg is NOT passed — confirmed empirically), so we
 * read it here. This ties every error group + Discord alert to the deploy a
 * fault first appeared in, powering "new in this release" and the regression
 * auto-reopen in error-groups.ts. `GIT_SHA` / `COMMIT_HASH` remain as explicit
 * overrides; falls back to 'dev' locally.
 */
export const GIT_SHA: string = (
  process.env.SOURCE_COMMIT ||
  process.env.GIT_SHA ||
  process.env.COMMIT_HASH ||
  'dev'
).slice(0, 12);
