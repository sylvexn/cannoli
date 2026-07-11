/**
 * First-party usage analytics — write side + rollup.
 *
 * recordUsageEvent is the ingest path for the public beacon endpoint
 * (/api/analytics/events). Privacy-light and cookieless: anonymous visitors
 * are keyed by a daily-rotating hash of salt+ip+ua (Plausible-style), so no
 * identifier is ever stored on the client and a visitor can't be tracked
 * across days. Best-effort throughout — an analytics failure must NEVER
 * surface to a real request, so everything is wrapped in try/catch (same
 * contract as lib/request-log.ts).
 *
 * Retention: raw usage_events rows keep ~90 days, pruned opportunistically on
 * insert. runUsageRollup aggregates each completed UTC day into usage_daily +
 * usage_daily_totals (idempotent — a day already in usage_daily_totals is
 * skipped), so long-term history survives the raw window. Registered in
 * lib/scheduler.ts and caught up once at boot from src/index.ts.
 */
import { createHash } from 'crypto';
import { db, schema, sqlite } from '../db';
import { tx } from './tx';

/** Raw rows older than this are pruned. */
const RETENTION_DAYS = 90;
/** Run the prune sweep once every N inserts (amortizes the DELETE cost). */
const PRUNE_EVERY = 500;

const MAX_PATH = 512;
const MAX_EVENT = 64;
const MAX_REFERRER = 300;

/** Non-human traffic — dropped silently (the beacon still returns 204). */
const BOT_UA_RE = /bot|crawler|spider|curl|wget|headless|lighthouse/i;
const MOBILE_UA_RE = /Mobi|Android|iPhone|iPad/i;

let insertsSincePrune = 0;

// ─── Anonymous visitor id ────────────────────────────────────────────────────

/** Cache the daily salt: (utcDay → salt). Recomputed when the UTC day rolls. */
let saltDay = '';
let saltValue = '';

/** sha256(`${secret}:${YYYY-MM-DD}`) — deterministic within a UTC day, rotates
 *  daily, so anon ids can't be joined across days. */
function dailySalt(): string {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== saltDay) {
    const secret = process.env.CANNOLI_CSRF_SECRET ?? 'dev-salt';
    saltValue = createHash('sha256').update(`${secret}:${day}`).digest('hex');
    saltDay = day;
  }
  return saltValue;
}

/** First 16 hex chars of sha256(dailySalt + ip + ua). */
function anonId(ip: string, ua: string): string {
  return createHash('sha256').update(dailySalt() + ip + ua).digest('hex').slice(0, 16);
}

// ─── Sanitization ────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path segment that looks like an entity id rather than a route word:
 *  pure number, uuid, long hex, or long alphanumeric containing a digit (the
 *  digit requirement keeps ordinary long words like "standings" intact). */
function looksLikeId(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (UUID_RE.test(seg)) return true;
  if (seg.length >= 8 && /^[0-9a-f]+$/i.test(seg)) return true;
  if (seg.length >= 8 && /^[0-9a-z]+$/i.test(seg) && /\d/.test(seg)) return true;
  return false;
}

/** Fallback when the client didn't send a router pattern: collapse id-looking
 *  segments to ':id' so route cardinality stays bounded. */
function normalizeRoute(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? '';
  return clean
    .split('/')
    .map(seg => (seg && looksLikeId(seg) ? ':id' : seg))
    .join('/') || '/';
}

/** Keep only external referrers (different host than the request), reduced to
 *  their origin so the top-referrers list groups by source, not per-URL. */
function externalReferrer(raw: unknown, request: Request): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const ref = new URL(raw);
    const selfHost =
      request.headers.get('x-forwarded-host') ??
      request.headers.get('host') ??
      new URL(request.url).host;
    if (ref.hostname === selfHost.split(':')[0]) return null;
    return ref.origin.slice(0, MAX_REFERRER);
  } catch {
    return null;
  }
}

/** Best-effort X-Forwarded-For first hop (we sit behind Coolify's proxy). */
function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? '';
}

// ─── Ingest ──────────────────────────────────────────────────────────────────

/**
 * Record one beacon hit. `input` is the raw (untrusted, possibly text/plain
 * sendBeacon) body; anything malformed is dropped silently. Never throws.
 */
export function recordUsageEvent(
  input: unknown,
  request: Request,
  user: { id: string } | null,
) {
  try {
    const ua = request.headers.get('user-agent') ?? '';
    if (BOT_UA_RE.test(ua)) return;

    // sendBeacon without a typed Blob arrives as text/plain → a string body.
    const body = typeof input === 'string' ? JSON.parse(input) : input;
    if (!body || typeof body !== 'object') return;
    const b = body as Record<string, unknown>;
    if (typeof b.path !== 'string' || !b.path) return;

    const path = b.path.slice(0, MAX_PATH);
    const route = typeof b.route === 'string' && b.route
      ? b.route.slice(0, MAX_PATH)
      : normalizeRoute(path);
    const event = typeof b.event === 'string' && b.event
      ? b.event.slice(0, MAX_EVENT)
      : 'pageview';

    const userId = user ? parseInt(user.id) : null;

    db.insert(schema.usageEvents).values({
      event,
      route,
      path,
      userId,
      anonId: userId != null ? null : anonId(clientIp(request), ua),
      device: MOBILE_UA_RE.test(ua) ? 'mobile' : 'desktop',
      referrer: externalReferrer(b.referrer, request),
    }).run();

    if (++insertsSincePrune >= PRUNE_EVERY) {
      insertsSincePrune = 0;
      prune();
    }
  } catch {
    /* never throw from analytics */
  }
}

/** Delete raw rows past the retention window. */
function prune() {
  try {
    sqlite
      .query(`DELETE FROM usage_events WHERE ts < datetime('now', ?)`)
      .run(`-${RETENTION_DAYS} days`);
  } catch {
    /* never throw from analytics */
  }
}

// ─── Daily rollup ────────────────────────────────────────────────────────────

/**
 * Aggregate every completed UTC day still present in usage_events into
 * usage_daily + usage_daily_totals. Idempotent: days already rolled up (their
 * usage_daily_totals row exists) are skipped, so this is safe to run hourly
 * AND once at boot as a catch-up. Never throws.
 */
export function runUsageRollup() {
  try {
    const days = sqlite.query<{ d: string }, []>(`
      SELECT DISTINCT date(ts) AS d FROM usage_events
      WHERE date(ts) < date('now')
        AND date(ts) NOT IN (SELECT date FROM usage_daily_totals)
      ORDER BY d
    `).all();

    for (const { d } of days) {
      tx(() => {
        // OR REPLACE guards against a half-written day from a crash mid-tx
        // predating the totals row (totals is written last = the commit marker).
        sqlite.query(`
          INSERT OR REPLACE INTO usage_daily (date, event, route, views, unique_users, unique_anons)
          SELECT date(ts), event, route, COUNT(*), COUNT(DISTINCT user_id), COUNT(DISTINCT anon_id)
          FROM usage_events
          WHERE date(ts) = ?
          GROUP BY event, route
        `).run(d);
        sqlite.query(`
          INSERT OR REPLACE INTO usage_daily_totals (date, views, unique_users, unique_anons)
          SELECT date(ts), COUNT(*), COUNT(DISTINCT user_id), COUNT(DISTINCT anon_id)
          FROM usage_events
          WHERE date(ts) = ?
        `).run(d);
      });
    }
    if (days.length > 0) {
      console.log(`[usage] rolled up ${days.length} day(s): ${days.map(x => x.d).join(', ')}`);
    }
  } catch (err) {
    console.error('[usage] rollup failed:', err);
  }
}
