import { lazy, type ComponentType } from 'react';

/**
 * Vite splits heavy routes into hashed chunks (e.g. `draft-board-DqcLcH3V.js`).
 * Every deploy re-hashes those filenames, so a browser still running the
 * pre-deploy SPA (or holding a cached index.html) references chunk names that
 * no longer exist on the server. The lazy `import()` then 404s and React throws
 * `TypeError: error loading dynamically imported module` — which our
 * PageErrorBoundary catches and reports, even though nothing is actually broken.
 *
 * `lazyWithReload` wraps the import factory: on a chunk-load failure it forces a
 * single full page reload to fetch the fresh index.html + chunk manifest, which
 * resolves the stale reference. A sessionStorage guard prevents a reload loop if
 * the chunk is genuinely missing (e.g. a real 500), in which case we rethrow and
 * let the error boundary render its fallback.
 */
const RELOAD_GUARD_KEY = 'cannoli:chunk-reload';

/** Heuristic: does this error look like a failed dynamic chunk import? */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /dynamically imported module/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

/**
 * Force a one-time full reload to recover from a stale chunk reference.
 * Returns true if a reload was triggered, false if the guard already fired this
 * session (meaning the chunk is genuinely unavailable — let the caller surface
 * the error instead of looping).
 */
function reloadOnce(): boolean {
  let alreadyReloaded = false;
  try {
    alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
    if (!alreadyReloaded) sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  } catch {
    /* ignore storage failures — fall through to reload once */
  }
  if (!alreadyReloaded) {
    window.location.reload();
    return true;
  }
  return false;
}

/**
 * Global safety net for stale chunks. Vite fires `vite:preloadError` whenever a
 * dynamically imported module fails to load — this covers EVERY dynamic import
 * (route lazies, runtime `import()` calls, vendor preloads), not just the ones
 * routed through `lazyWithReload`. We reload once to fetch the fresh manifest;
 * `preventDefault()` stops Vite's default of rethrowing the error. Install once
 * at app bootstrap.
 */
export function installChunkReloadHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });
}

// `ComponentType<any>` (not `<unknown>`) mirrors React's own `lazy` signature —
// it's required so routes whose component takes specific props (e.g. DraftBoardPage's
// optional DraftBoardPageProps) still satisfy the constraint. With `<unknown>`,
// inference collapses to a `{ default: never }` union and fails the prod `tsc -b` build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      // Successful load — clear the guard so a future deploy can reload again.
      try {
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
      } catch {
        /* sessionStorage may be unavailable (private mode / blocked) */
      }
      return mod;
    } catch (err) {
      if (isChunkLoadError(err) && reloadOnce()) {
        // Never resolve: keep React in the Suspense fallback through the
        // reload rather than flashing the error boundary.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
