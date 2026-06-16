/**
 * Build/release identity. The git SHA is baked into the image at build time
 * (Dockerfile sets GIT_SHA) so every error group and Discord alert can be tied
 * to the deploy it first appeared in — powering "new in this release" and the
 * regression auto-reopen in error-groups.ts. Falls back to 'dev' locally.
 */
export const GIT_SHA: string =
  process.env.GIT_SHA || process.env.COMMIT_HASH || 'dev';
