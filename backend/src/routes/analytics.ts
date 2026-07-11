/**
 * Usage-analytics beacon — the public write side of the admin "Usage" tab.
 *
 * The frontend fires one POST per client-side navigation (pageview) or named
 * feature event, typically via navigator.sendBeacon. Open to unauthenticated
 * callers on purpose (anonymous visitors are the point) and CSRF-exempt in
 * src/index.ts because sendBeacon cannot attach the X-CSRF-Token header.
 *
 * Always 204, no body, best-effort: parsing/derivation/insert all live in
 * recordUsageEvent (lib/usage.ts) which never throws — a broken beacon must
 * never surface an error to the app. No Elysia body schema either: a
 * validation failure would 422 instead of 204, and sendBeacon string payloads
 * arrive as text/plain.
 */
import { Elysia } from 'elysia';
import { recordUsageEvent } from '../lib/usage';
import type { AuthUser } from '../middleware/auth';

export const analyticsRoutes = new Elysia()
  .post('/api/analytics/events', ({ body, request, ...ctx }) => {
    const user = (ctx as { user?: AuthUser | null }).user ?? null;
    recordUsageEvent(body, request, user ? { id: user.id } : null);
    return new Response(null, { status: 204 });
  });
