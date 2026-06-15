/**
 * Client-side error reporting. Sends browser faults to the backend
 * (/api/client-errors), which stores them as source='client' rows in the same
 * table the dev "API Logs" tab reads. Returns a short correlation ref the UI
 * can show the user and attach to a feedback issue.
 *
 * Three entry points feed this:
 *   - installGlobalErrorReporting()  → window.onerror + unhandledrejection
 *   - PageErrorBoundary.componentDidCatch → React render crashes
 *
 * Everything here is best-effort and must never throw: reporting an error can't
 * itself become a new error the user sees.
 */
import { api } from './api';

/** Don't spam the backend with the same fault on a tight loop. Dedupe by a
 *  signature for a short window. */
const recent = new Map<string, number>();
const DEDUPE_MS = 10_000;

function isDuplicate(signature: string): boolean {
  const now = Date.now();
  // Opportunistic cleanup so the map can't grow unbounded.
  for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  if (recent.has(signature)) return true;
  recent.set(signature, now);
  return false;
}

export interface ReportInput {
  message: string;
  name?: string;
  stack?: string;
  kind?: 'render' | 'window' | 'unhandledrejection';
}

/**
 * Report a fault. Returns the server-issued correlation ref, or null if the
 * report was deduped/failed. Never throws.
 */
export async function reportClientError(input: ReportInput): Promise<string | null> {
  try {
    const page = typeof window !== 'undefined' ? window.location.pathname : '/';
    const signature = `${input.kind ?? ''}|${input.name ?? ''}|${input.message}`.slice(0, 300);
    if (isDuplicate(signature)) return null;

    const res = await api.reportClientError({
      page,
      message: input.message || 'Unknown error',
      name: input.name,
      stack: input.stack,
      kind: input.kind,
    });
    return res.errorId ?? null;
  } catch {
    return null;
  }
}

let installed = false;

/** Wire window-level handlers once, at app boot. */
export function installGlobalErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    void reportClientError({
      kind: 'window',
      name: e.error?.name,
      message: e.message || String(e.error?.message ?? 'Unknown error'),
      stack: e.error?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    void reportClientError({
      kind: 'unhandledrejection',
      name: reason?.name,
      message: reason?.message ?? String(reason ?? 'Unhandled promise rejection'),
      stack: reason?.stack,
    });
  });
}
