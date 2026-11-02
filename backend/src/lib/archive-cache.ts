/**
 * Memo for archived-season aggregates. Archived seasons are immutable, so the
 * only invalidation needed is the archive toggle (clearArchiveCache) plus a TTL
 * so cosmetic edits (team/coach names) still surface eventually.
 */
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

export function archiveMemo<T>(key: string, compute: () => T): T {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = compute();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearArchiveCache(): void {
  cache.clear();
}
