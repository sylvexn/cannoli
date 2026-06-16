/**
 * Breadcrumb trail for client error reports. Records the last 20 user actions
 * (navigation, clicks, API calls) so that when an error fires we can attach
 * "user did X → Y → Z then it crashed" context to the report.
 *
 * Design choices:
 *  - Ring buffer capped at 20: enough signal, bounded memory.
 *  - Framework-agnostic: no React imports, safe to call from api.ts or anywhere.
 *  - Never throws: all public functions swallow exceptions so they can never
 *    themselves become the error we are trying to report.
 *  - installBreadcrumbs() is idempotent: calling it twice is a no-op, so it is
 *    safe to call from installGlobalErrorReporting() without worrying about
 *    double-patching in HMR hot-reload cycles during development.
 */

// Vite injects this at build time via the `define` block in vite.config.ts.
declare const __COMMIT_HASH__: string;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Breadcrumb {
  /** ISO timestamp so the server can reconstruct a timeline. */
  t: string;
  type: 'nav' | 'click' | 'api' | 'log';
  message: string;
  /** Arbitrary key/value extras (e.g. HTTP status, element tag). */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

const MAX = 20;
const buffer: Breadcrumb[] = [];

/**
 * Append a breadcrumb, dropping the oldest when the buffer exceeds MAX.
 * Safe to call from anywhere — swallows all exceptions.
 */
export function pushBreadcrumb(
  type: Breadcrumb['type'],
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    const crumb: Breadcrumb = { t: new Date().toISOString(), type, message };
    if (meta !== undefined) crumb.meta = meta;
    buffer.push(crumb);
    if (buffer.length > MAX) buffer.shift();
  } catch {
    // Best-effort; breadcrumb recording must never crash the app.
  }
}

/**
 * Return a shallow copy of the current buffer so callers can't mutate it.
 * Oldest entry first (chronological order).
 */
export function getBreadcrumbs(): Breadcrumb[] {
  try {
    return buffer.slice();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// APP_VERSION
// ---------------------------------------------------------------------------

/**
 * The git commit hash injected by Vite at build time. Lets the backend tie a
 * crash report to a specific release without relying on user-agent sniffing.
 * Falls back to 'unknown' for local dev environments where the env var is unset.
 */
export const APP_VERSION: string = (() => {
  try {
    // __COMMIT_HASH__ is a string literal after Vite's define replacement.
    // In unit-test / SSR contexts where Vite hasn't run, the identifier is
    // undefined at runtime even though TypeScript thinks it exists — hence the
    // typeof guard.
    return typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'unknown';
  } catch {
    return 'unknown';
  }
})();

// ---------------------------------------------------------------------------
// Auto-instrumentation
// ---------------------------------------------------------------------------

let _installed = false;

/**
 * Install document-level listeners and monkey-patch browser APIs to
 * automatically push breadcrumbs. Call once at app boot (e.g. alongside
 * installGlobalErrorReporting). Idempotent — safe to call multiple times.
 */
export function installBreadcrumbs(): void {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  // --- Navigation -----------------------------------------------------------
  // SPA navigations go through history.pushState / replaceState — they don't
  // fire the native 'navigate' event in all browsers, so we patch the history
  // methods. popstate covers the browser back/forward buttons.

  const _pushState = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    try {
      // args[2] is the url parameter (string | URL | null | undefined)
      const raw = args[2];
      const pathname = raw ? new URL(String(raw), location.href).pathname : location.pathname;
      pushBreadcrumb('nav', pathname, { method: 'pushState' });
    } catch { /* swallow */ }
    return _pushState(...args);
  };

  history.replaceState = function (...args) {
    try {
      const raw = args[2];
      const pathname = raw ? new URL(String(raw), location.href).pathname : location.pathname;
      pushBreadcrumb('nav', pathname, { method: 'replaceState' });
    } catch { /* swallow */ }
    return _replaceState(...args);
  };

  window.addEventListener('popstate', () => {
    try {
      pushBreadcrumb('nav', location.pathname, { method: 'popstate' });
    } catch { /* swallow */ }
  });

  // --- Clicks ---------------------------------------------------------------
  // Capture phase so we see clicks even if a handler calls stopPropagation.
  // We label the element by preference: [data-track] attr → button/a text →
  // tagName. Text is capped at 60 chars to keep payloads small.

  document.addEventListener('click', (e: MouseEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Walk up to find a meaningful ancestor (e.g. click on an icon inside a button).
      const el = target.closest<HTMLElement>('[data-track], button, a') ?? target;

      let label: string;
      const tracked = el.getAttribute('data-track');
      if (tracked) {
        label = tracked;
      } else {
        const text = el.textContent?.trim() ?? '';
        label = text.length > 0 ? text.slice(0, 60) : el.tagName.toLowerCase();
      }

      pushBreadcrumb('click', label, { tag: el.tagName.toLowerCase() });
    } catch { /* swallow */ }
  }, { capture: true });

  // --- Fetch ----------------------------------------------------------------
  // We only care about /api/ calls (skip CDN, analytics, etc.) and we
  // explicitly skip /api/client-errors to avoid a feedback loop where the
  // error-report fetch itself generates a breadcrumb that gets included in the
  // next error report ad infinitum.

  const _fetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    let url = '';
    try {
      url = typeof input === 'string' ? input
          : input instanceof URL ? input.pathname
          : (input as Request).url;
    } catch { /* swallow */ }

    const isApi = url.includes('/api/');
    const isSelf = url.includes('/api/client-errors');

    if (!isApi || isSelf) {
      // Not an API call we care about — pass straight through.
      return _fetch(input, init);
    }

    // Extract method and path (strip query string) for a concise label.
    let method = 'GET';
    let path = url;
    try {
      method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      path = new URL(url, location.href).pathname;
    } catch { /* swallow */ }

    try {
      const response = await _fetch(input, init);
      // Breadcrumb AFTER the response so we can include the status code.
      pushBreadcrumb('api', `${method} ${path} → ${response.status}`, { status: response.status });
      return response;
    } catch (err) {
      pushBreadcrumb('api', `${method} ${path} → ERR`);
      throw err;
    }
  };
}
