/**
 * First-party usage beacon — fire-and-forget POSTs to /api/analytics/events.
 *
 * Transport is navigator.sendBeacon (survives page unload, never blocks
 * navigation) with a keepalive fetch fallback. Analytics must never break the
 * app: every path swallows errors and nothing here is awaited by callers.
 *
 * The matched route PATTERN is intentionally not sent: the app uses a plain
 * <BrowserRouter> JSX route tree (no data router), so useMatches() isn't
 * available and rebuilding a normalizer client-side would be fragile — the
 * server derives bounded-cardinality route patterns from the raw path.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || '';
const ENDPOINT = `${API_BASE}/api/analytics/events`;

interface BeaconBody {
  path: string;
  route?: string | null;
  event?: string | null;
  referrer?: string | null;
}

function send(body: BeaconBody): void {
  try {
    const json = JSON.stringify(body);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const queued = navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }));
      if (queued) return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: json,
    }).catch(() => {});
  } catch {
    // Never let analytics surface an error.
  }
}

/** Report a named feature event (e.g. 'matchup.compare'). Fire-and-forget. */
export function trackEvent(event: string): void {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  send({ path, event });
}

let lastPageviewPath: string | null = null;

function trackPageview(path: string, referrer?: string): void {
  if (path === lastPageviewPath) return;
  lastPageviewPath = path;
  send({ path, referrer: referrer || undefined });
}

/**
 * Auto-pageview hook — mount exactly once, inside the router context.
 * Fires on initial load (with document.referrer) and on every subsequent
 * route change; consecutive duplicates of the same path are skipped.
 */
export function usePageviewBeacon(): void {
  const { pathname } = useLocation();
  const firstHit = useRef(true);
  useEffect(() => {
    if (firstHit.current) {
      firstHit.current = false;
      trackPageview(pathname, document.referrer || undefined);
    } else {
      trackPageview(pathname);
    }
  }, [pathname]);
}
