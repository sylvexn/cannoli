/**
 * Internal endpoints called by the Pokemon Showdown game server.
 *
 * These are NOT user-facing. They are scoped behind a shared secret
 * (`PS_INTERNAL_SECRET`) that both the Cannoli backend and the PS server
 * container know. Used by the PS startup hook to materialise per-league
 * chat rooms without baking league data into the PS docker image.
 *
 * Why a shared secret instead of mTLS or a real auth flow:
 *   - PS and Cannoli share the same `coolify` docker network, so this
 *     channel never leaves the host. The secret is a defence-in-depth
 *     measure against accidental exposure if the route is reverse-proxied.
 *   - The endpoint returns league metadata that's also visible publicly
 *     via /api/leagues — no actual privilege escalation here, just a
 *     convenience endpoint shaped for the PS server's needs.
 */
import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { desc, eq } from 'drizzle-orm';

const PS_INTERNAL_SECRET = process.env.PS_INTERNAL_SECRET || '';

const ACTIVE_PHASES = ['predraft', 'draft', 'regular', 'playoffs'] as const;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const psInternalRoutes = new Elysia()

  /**
   * GET /api/internal/ps/leagues
   * Header: X-PS-Secret: <PS_INTERNAL_SECRET>
   *
   * Returns active leagues for the current season, shaped for the PS
   * startup hook. Excludes archived seasons and offseason leagues so the
   * PS chat room list stays current.
   *
   * Response shape:
   *   { leagues: [{ slug, name, displayName, currentWeek, phase }] }
   */
  .get('/api/internal/ps/leagues', ({ request }) => {
    if (!PS_INTERNAL_SECRET) {
      console.warn('[ps-internal] PS_INTERNAL_SECRET not set — refusing all requests');
      return unauthorized();
    }
    const provided = request.headers.get('x-ps-secret');
    if (!provided || provided !== PS_INTERNAL_SECRET) return unauthorized();

    // Most-recent non-archived season. The room list reflects the current
    // active set; old leagues fall off naturally as seasons archive.
    const season = db.select().from(schema.seasons)
      .where(eq(schema.seasons.archived, false))
      .orderBy(desc(schema.seasons.seasonNumber))
      .get();
    if (!season) return { leagues: [] };

    const rows = db.select().from(schema.leagues)
      .where(eq(schema.leagues.seasonId, season.id))
      .all();

    const leagues = rows
      .filter(l => (ACTIVE_PHASES as readonly string[]).includes(l.phase))
      .map(l => ({
        slug: l.id,
        name: l.name,
        // PS room titles show the season tag so coaches can tell S10 Sapphire
        // from S11 Sapphire when both linger in the room list briefly.
        displayName: `${l.name} S${season.seasonNumber}`,
        currentWeek: l.currentWeek,
        phase: l.phase,
      }));

    return { leagues, season: { number: season.seasonNumber } };
  });
