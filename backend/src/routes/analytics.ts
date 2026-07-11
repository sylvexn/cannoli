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
 * never surface an error to the app. The `parse` hook hands the raw text
 * straight through (no Elysia body schema / JSON parser): a malformed body
 * would otherwise 400/422 in the framework before the handler ever ran, and
 * sendBeacon string payloads arrive as text/plain anyway.
 */
import { Elysia } from 'elysia';
import { recordUsageEvent } from '../lib/usage';
import type { AuthUser } from '../middleware/auth';

export const analyticsRoutes = new Elysia()
  .post('/api/analytics/events', ({ body, request, ...ctx }) => {
    const user = (ctx as { user?: AuthUser | null }).user ?? null;
    recordUsageEvent(body, request, user ? { id: user.id } : null);
    return new Response(null, { status: 204 });
  }, {
    parse: ({ request }) => request.text().catch(() => ''),
  });
