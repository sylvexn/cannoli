/**
 * Durable notification core — directed per-user notifications.
 *
 * notifyUser() inserts into the `notifications` table with INSERT OR IGNORE
 * semantics so repeated calls with the same dedupeKey are idempotent (e.g.
 * backfill re-runs, GitHub-close re-detection).
 *
 * Cross-references:
 *   - schema: backend/src/db/schema.ts (notifications, users)
 *   - consumer: backend/src/routes/feedback.ts + routes/admin/misc.ts
 *   - GitHub issue body format is also written in backend/src/routes/feedback.ts
 *     parseReporterUsername MUST stay in sync with that format.
 */
import { db, schema, sqlite } from '../../db';
import { eq, inArray } from 'drizzle-orm';
import { Octokit } from 'octokit';

// ─── notifyUser ──────────────────────────────────────────────────────────────

export type NotifyResult = 'inserted' | 'skipped';

export interface NotifyOpts {
  type: 'feedback' | 'system';
  title: string;
  body?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}

/**
 * Insert a directed notification for a user. Returns 'inserted' if a new row
 * was added, 'skipped' if the dedupeKey already existed for this user (or on
 * any unexpected error — never throws).
 */
export function notifyUser(userId: number, opts: NotifyOpts): NotifyResult {
  try {
    const metadataJson = opts.metadata != null ? JSON.stringify(opts.metadata) : null;

    // drizzle-orm's .onConflictDoNothing() produces INSERT OR IGNORE in SQLite.
    // We rely on the UNIQUE(user_id, dedupe_key) index on the notifications table.
    // When dedupeKey is null SQLite treats every null as distinct, so no conflict
    // fires and we always insert.
    const result = db.insert(schema.notifications).values({
      userId,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? null,
      link: opts.link ?? null,
      metadata: metadataJson,
      dedupeKey: opts.dedupeKey ?? null,
    }).onConflictDoNothing().run();

    // `changes` is the number of rows actually inserted (0 on conflict).
    return (result.changes ?? 0) > 0 ? 'inserted' : 'skipped';
  } catch (e) {
    // If .onConflictDoNothing() isn't available in the installed drizzle-orm
    // version, fall back to a raw INSERT OR IGNORE to guarantee idempotency.
    try {
      const metadataJson = opts.metadata != null ? JSON.stringify(opts.metadata) : null;
      const stmt = sqlite.prepare<void, [number, string, string, string | null, string | null, string | null, string | null]>(
        `INSERT OR IGNORE INTO notifications (user_id, type, title, body, link, metadata, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const info = stmt.run(
        userId,
        opts.type,
        opts.title,
        opts.body ?? null,
        opts.link ?? null,
        metadataJson,
        opts.dedupeKey ?? null,
      );
      return (info.changes ?? 0) > 0 ? 'inserted' : 'skipped';
    } catch (e2) {
      console.error('[notify] notifyUser failed:', e2);
      return 'skipped';
    }
  }
}

// ─── notifyStaff ─────────────────────────────────────────────────────────────

/**
 * Notify every dev/admin user with the same directed notification. Used for
 * events that need admin attention (trade/FA/tera approval queue). `bot`
 * (service accounts) is intentionally excluded — this targets human staff.
 *
 * Loops notifyUser() per recipient, so dedupeKey idempotency and per-row
 * error isolation (never throws) both apply. Best-effort: never throws.
 */
export function notifyStaff(opts: NotifyOpts): void {
  try {
    const staff = db.select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.role, ['dev', 'admin']))
      .all();
    for (const s of staff) {
      notifyUser(s.id, opts);
    }
  } catch (e) {
    console.error('[notify] notifyStaff failed:', e);
  }
}

// ─── parseReporterUsername ───────────────────────────────────────────────────

/**
 * Extract the reporter username from the GitHub issue body.
 *
 * The body line written by feedback.ts is:
 *   **Reporter:** <username> (<role>)
 *
 * IMPORTANT: this regex MUST stay in sync with the issue body template in
 * backend/src/routes/feedback.ts. If that format changes, update both.
 */
export function parseReporterUsername(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = body.match(/^\*\*Reporter:\*\*\s+(\S+)\s+\(/m);
  return m ? m[1] : null;
}

// ─── notifyFeedbackResolved ──────────────────────────────────────────────────

export type FeedbackNotifyResult = 'inserted' | 'skipped' | 'no-user';

/**
 * Notify the reporter of a resolved GitHub issue. Looks up the user by username
 * (usernames are unique). Returns 'no-user' if the username has no DB account.
 */
export function notifyFeedbackResolved(args: {
  issueNumber: number;
  issueUrl: string;
  issueTitle: string;
  reporterUsername: string;
}): FeedbackNotifyResult {
  const user = db.select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, args.reporterUsername))
    .get();

  if (!user) return 'no-user';

  const result = notifyUser(user.id, {
    type: 'feedback',
    title: 'Your feedback was addressed',
    body: args.issueTitle,
    link: args.issueUrl,
    metadata: { issueNumber: args.issueNumber },
    dedupeKey: `feedback:issue:${args.issueNumber}`,
  });

  return result;
}

// ─── backfillFeedbackNotifications ──────────────────────────────────────────

export interface BackfillResult {
  inserted: number;
  skipped: number;
  noUser: number;
  unconfigured?: boolean;
}

/**
 * Backfill resolved-feedback notifications from GitHub for a list of issue
 * numbers. Uses the same notifyFeedbackResolved funnel that the resolve handler
 * and future close-detector go through, so dedupeKey guarantees idempotency.
 *
 * Defaults to the set of known feedback issues if no list is provided.
 */
export async function backfillFeedbackNotifications(issueNumbers?: number[]): Promise<BackfillResult> {
  const ghToken = process.env.GITHUB_TOKEN;
  const ghRepo = process.env.GITHUB_REPO;

  if (!ghToken || !ghRepo) {
    return { inserted: 0, skipped: 0, noUser: 0, unconfigured: true };
  }

  const octokit = new Octokit({ auth: ghToken });
  const [owner, repo] = ghRepo.split('/');
  const numbers = issueNumbers?.length ? issueNumbers : [13, 14, 15, 16, 17];

  let inserted = 0;
  let skipped = 0;
  let noUser = 0;

  for (const issueNumber of numbers) {
    try {
      const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });

      // Only act on closed issues — open ones are not yet resolved.
      if (data.state !== 'closed') {
        skipped++;
        continue;
      }

      const reporterUsername = parseReporterUsername(data.body);
      if (!reporterUsername) {
        skipped++;
        continue;
      }

      const r = notifyFeedbackResolved({
        issueNumber,
        issueUrl: data.html_url,
        issueTitle: data.title,
        reporterUsername,
      });

      if (r === 'inserted') inserted++;
      else if (r === 'no-user') noUser++;
      else skipped++;
    } catch {
      // Issue deleted or unreachable — count as skipped.
      skipped++;
    }
  }

  return { inserted, skipped, noUser };
}
