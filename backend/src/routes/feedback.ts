import { Elysia } from 'elysia';
import { Octokit } from 'octokit';
import { db, schema } from '../db';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { alertFeedback } from '../lib/alert';
import { isR2Configured, r2Put, r2PublicUrl } from '../lib/r2';
import { writeUpload } from '../lib/uploads';
import { notifyUser } from '../lib/notifications/notify';
import { isStaff } from '../lib/auth';

const ghToken = process.env.GITHUB_TOKEN;
const ghRepo = process.env.GITHUB_REPO;
const octokit = ghToken ? new Octokit({ auth: ghToken }) : null;

const VALID_CATEGORIES = ['bug', 'feature', 'league', 'general'] as const;
type FeedbackCategory = typeof VALID_CATEGORIES[number];

export const feedbackRoutes = new Elysia()

  // ─── POST /api/feedback ─────────────────────────────────────────────────────
  // Multipart form. Fields: category, title, description, optional page,
  // optional errorRef, optional screenshot (File).
  // ALWAYS inserts a `feedback` row. For bug/feature + GitHub configured:
  // creates an issue; on GitHub failure logs but does NOT 502 (row + Discord
  // already succeeded). Does NOT write feedbackSubmissions (deprecated table).

  .post('/api/feedback', async ({ request, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      set.status = 400;
      return { error: 'Failed to parse form data' };
    }

    const category = (form.get('category') as string | null)?.trim() ?? '';
    const title = (form.get('title') as string | null)?.trim() ?? '';
    const description = (form.get('description') as string | null)?.trim() ?? '';
    const page = (form.get('page') as string | null)?.trim() || null;
    const errorRef = (form.get('errorRef') as string | null)?.trim() || null;

    if (!VALID_CATEGORIES.includes(category as FeedbackCategory)) {
      set.status = 400;
      return { error: 'category must be one of: bug, feature, league, general' };
    }
    if (!title) { set.status = 400; return { error: 'title is required' }; }
    if (!description) { set.status = 400; return { error: 'description is required' }; }

    // ── Screenshot upload (best-effort) ────────────────────────────────────
    let screenshotPath: string | null = null;
    const screenshotField = form.get('screenshot');
    if (screenshotField instanceof File && screenshotField.size > 0) {
      if (!screenshotField.type.startsWith('image/')) {
        // Not blocking — just skip
        console.warn('[feedback] screenshot rejected: not an image', screenshotField.type);
      } else if (screenshotField.size > 2 * 1024 * 1024) {
        console.warn('[feedback] screenshot rejected: > 2MB', screenshotField.size);
      } else {
        try {
          const key = `feedback-screenshots/${crypto.randomUUID()}.png`;
          if (isR2Configured()) {
            const buf = await screenshotField.arrayBuffer();
            await r2Put(key, buf, screenshotField.type);
            screenshotPath = r2PublicUrl(key);
          } else {
            await writeUpload(key, screenshotField);
            screenshotPath = key;
          }
        } catch (e: any) {
          console.error('[feedback] screenshot upload failed:', e.message);
          screenshotPath = null;
        }
      }
    }

    // ── Insert feedback row ───────────────────────────────────────────────
    const inserted = db.insert(schema.feedback).values({
      userId: parseInt(user.id),
      category: category as FeedbackCategory,
      title,
      body: description,
      page,
      errorRef,
      screenshotPath,
    }).returning({ id: schema.feedback.id }).get();

    const feedbackId = inserted!.id;

    // ── Discord mirror (always) ───────────────────────────────────────────
    // NOTE: if issueUrl is set below (after GitHub issue creation), alertFeedback
    // is called again with it. The first call fires immediately so Discord
    // always gets notified even if GitHub is slow or fails.
    alertFeedback({
      title,
      description,
      page,
      reporter: user.username,
      role: user.role,
      errorRef,
      category,
    });

    // ── GitHub issue (bug/feature only, when configured) ──────────────────
    let issueNumber: number | null = null;
    let issueUrl: string | null = null;

    if (
      octokit && ghRepo &&
      (category === 'bug' || category === 'feature')
    ) {
      const [owner, repo] = ghRepo.split('/');

      // Body format — IMPORTANT: parseReporterUsername() in
      // backend/src/lib/notifications/notify.ts relies on the line:
      //   **Reporter:** <username> (<role>)
      // to extract the reporter for backfill. Do not change that line's format
      // without updating the regex there.
      const issueBody = [
        description,
        '',
        '---',
        `**Reporter:** ${user.username} (${user.role})`,
        `**Category:** ${category}`,
        page ? `**Page:** ${page}` : null,
        errorRef ? `**Error ref:** ${errorRef}` : null,
        `**Submitted:** ${new Date().toISOString()}`,
      ].filter(Boolean).join('\n');

      try {
        const { data } = await octokit.rest.issues.create({
          owner, repo,
          title,
          body: issueBody,
          labels: ['feedback', category === 'bug' ? 'bug' : 'enhancement'],
        });

        issueNumber = data.number;
        issueUrl = data.html_url;

        // Update the feedback row with GitHub metadata.
        db.update(schema.feedback).set({
          githubIssueNumber: issueNumber,
          githubIssueUrl: issueUrl,
        }).where(eq(schema.feedback.id, feedbackId)).run();

        // Re-alert Discord with the issue link.
        alertFeedback({
          title,
          description,
          page,
          reporter: user.username,
          role: user.role,
          errorRef,
          category,
          issueUrl,
        });
      } catch (e: any) {
        // GitHub failure is non-fatal — the feedback row + Discord already
        // captured the submission. Log and continue.
        console.error('[feedback] GitHub issue creation failed:', e.message);
      }
    }

    return { success: true, id: feedbackId, issueNumber, issueUrl };
  })

  // ─── Feedback resolution sync (silent; called on login) ─────────────────────
  // Detects GitHub issues — both new `feedback` rows and any legacy
  // `feedback_submissions` — that have been closed since last checked, and emits
  // a directed pane notification to the reporter via notifyUser. Idempotent on
  // dedupeKey 'feedback:issue:<n>' (shared with the admin backfill, so a closure
  // can never double-notify). Returns a count only — no toast payload. This is
  // the ONGOING half of the GitHub-issue → reporter → notification pattern; the
  // admin backfill endpoint is the retroactive half.
  .get('/api/feedback/notifications', async ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!octokit || !ghRepo) return { notified: 0 };
    const [owner, repo] = ghRepo.split('/');
    const userId = parseInt(user.id);
    let notified = 0;

    const closeAndNotify = (issueNumber: number, link: string | null, title: string): boolean => {
      const res = notifyUser(userId, {
        type: 'feedback',
        title: `Your feedback "${title}" was resolved`,
        body: null,
        link,
        metadata: { issueNumber },
        dedupeKey: `feedback:issue:${issueNumber}`,
      });
      return res === 'inserted';
    };

    // New feedback table: bug/feature rows whose GitHub issue is still open.
    const rows = db.select().from(schema.feedback)
      .where(and(eq(schema.feedback.userId, userId), eq(schema.feedback.status, 'open')))
      .all();
    for (const row of rows) {
      if (!row.githubIssueNumber) continue;
      try {
        const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: row.githubIssueNumber });
        if (data.state === 'closed') {
          if (closeAndNotify(row.githubIssueNumber, row.githubIssueUrl ?? null, row.title)) notified++;
          db.update(schema.feedback)
            .set({ status: 'resolved', resolvedAt: new Date().toISOString() })
            .where(eq(schema.feedback.id, row.id)).run();
        }
      } catch { /* deleted issue; skip */ }
    }

    // Legacy feedback_submissions (pre-rework rows, never migrated).
    const submissions = db.select().from(schema.feedbackSubmissions)
      .where(and(
        eq(schema.feedbackSubmissions.userId, userId),
        isNull(schema.feedbackSubmissions.acknowledgedAt),
      ))
      .all();
    for (const sub of submissions) {
      try {
        const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: sub.issueNumber });
        if (data.state === 'closed') {
          if (closeAndNotify(sub.issueNumber, sub.issueUrl, sub.title)) notified++;
          db.update(schema.feedbackSubmissions)
            .set({ acknowledgedAt: new Date().toISOString() })
            .where(eq(schema.feedbackSubmissions.id, sub.id)).run();
        }
      } catch { /* deleted issue; skip */ }
    }

    return { notified };
  })

  // ─── GET /api/admin/feedback ─────────────────────────────────────────────────
  // Admin triage list. Filters: category, status, hasGithub. Default = all.

  .get('/api/admin/feedback', ({ query, set, user }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const rows = db.select({
      id: schema.feedback.id,
      category: schema.feedback.category,
      title: schema.feedback.title,
      body: schema.feedback.body,
      page: schema.feedback.page,
      errorRef: schema.feedback.errorRef,
      screenshotPath: schema.feedback.screenshotPath,
      githubIssueNumber: schema.feedback.githubIssueNumber,
      githubIssueUrl: schema.feedback.githubIssueUrl,
      status: schema.feedback.status,
      adminResponse: schema.feedback.adminResponse,
      resolvedAt: schema.feedback.resolvedAt,
      createdAt: schema.feedback.createdAt,
      userId: schema.feedback.userId,
      reporterUsername: schema.users.username,
      reporterRole: schema.users.role,
    })
      .from(schema.feedback)
      .leftJoin(schema.users, eq(schema.feedback.userId, schema.users.id))
      .orderBy(desc(schema.feedback.createdAt))
      .limit(100)
      .all();

    // Post-filter (SQLite via drizzle doesn't easily do conditional WHERE chains here)
    const categoryFilter = (query as any)?.category as string | undefined;
    const statusFilter = (query as any)?.status as string | undefined;
    const hasGithubFilter = (query as any)?.hasGithub as string | undefined;

    const filtered = rows.filter(r => {
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (hasGithubFilter === 'true' && r.githubIssueNumber == null) return false;
      if (hasGithubFilter === 'false' && r.githubIssueNumber != null) return false;
      return true;
    });

    return filtered.map(r => ({
      id: r.id,
      category: r.category,
      title: r.title,
      body: r.body,
      page: r.page ?? null,
      errorRef: r.errorRef ?? null,
      screenshotUrl: r.screenshotPath
        ? (r.screenshotPath.startsWith('http') ? r.screenshotPath : `/uploads/${r.screenshotPath}`)
        : null,
      githubIssueNumber: r.githubIssueNumber ?? null,
      githubIssueUrl: r.githubIssueUrl ?? null,
      status: r.status,
      adminResponse: r.adminResponse ?? null,
      reporter: r.reporterUsername ?? 'unknown',
      reporterRole: r.reporterRole ?? 'user',
      resolvedAt: r.resolvedAt ?? null,
      createdAt: r.createdAt,
    }));
  })

  // ─── POST /api/admin/feedback/:id/resolve ──────────────────────────────────
  // Marks a feedback item resolved, stores optional admin response,
  // and notifies the reporter.

  .post('/api/admin/feedback/:id/resolve', ({ params, body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }

    const id = parseInt(params.id);
    if (!Number.isFinite(id)) { set.status = 400; return { error: 'Invalid id' }; }

    const { response } = (body ?? {}) as { response?: string };

    const row = db.select().from(schema.feedback)
      .where(eq(schema.feedback.id, id))
      .get();
    if (!row) { set.status = 404; return { error: 'Feedback not found' }; }

    const now = new Date().toISOString();
    db.update(schema.feedback).set({
      status: 'resolved',
      adminResponse: response ?? null,
      resolvedByUserId: parseInt(user.id),
      resolvedAt: now,
    }).where(eq(schema.feedback.id, id)).run();

    // Notify the reporter
    notifyUser(row.userId, {
      type: 'feedback',
      title: `Your feedback "${row.title}" was resolved`,
      body: response ?? null,
      link: row.githubIssueUrl ?? '/',
    });

    return { success: true };
  });
