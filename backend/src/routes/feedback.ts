import { Elysia } from 'elysia';
import { Octokit } from 'octokit';
import { isDev } from '../lib/auth';
import { db, schema } from '../db';
import { eq, and, isNull } from 'drizzle-orm';

const ghToken = process.env.GITHUB_TOKEN;
const ghRepo = process.env.GITHUB_REPO;
const octokit = ghToken ? new Octokit({ auth: ghToken }) : null;

export const feedbackRoutes = new Elysia()

  .post('/api/feedback', async ({ body, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!octokit || !ghRepo) { set.status = 503; return { error: 'Feedback not configured' }; }

    const { title, description, page } = body as { title: string; description: string; page?: string };
    if (!title?.trim()) { set.status = 400; return { error: 'Title required' }; }
    if (!description?.trim()) { set.status = 400; return { error: 'Description required' }; }

    const [owner, repo] = ghRepo.split('/');
    const issueBody = [
      description.trim(),
      '',
      '---',
      `**Reporter:** ${user.username} (${user.role})`,
      page ? `**Page:** ${page}` : null,
      `**Submitted:** ${new Date().toISOString()}`,
    ].filter(Boolean).join('\n');

    try {
      const { data } = await octokit.rest.issues.create({
        owner, repo,
        title: title.trim(),
        body: issueBody,
        labels: ['feedback'],
      });

      // Track submission locally for notifications
      db.insert(schema.feedbackSubmissions).values({
        userId: parseInt(user.id),
        issueNumber: data.number,
        issueUrl: data.html_url,
        title: title.trim(),
      }).run();

      return { success: true, issueNumber: data.number, issueUrl: data.html_url };
    } catch (e: any) {
      console.error('GitHub issue creation failed:', e.message);
      set.status = 502;
      return { error: 'Failed to create issue' };
    }
  })

  // Notifications: resolved issues the user hasn't acknowledged yet
  .get('/api/feedback/notifications', async ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    if (!octokit || !ghRepo) return [];

    // Get unacknowledged submissions for this user
    const submissions = db.select().from(schema.feedbackSubmissions)
      .where(and(
        eq(schema.feedbackSubmissions.userId, parseInt(user.id)),
        isNull(schema.feedbackSubmissions.acknowledgedAt),
      ))
      .all();

    if (submissions.length === 0) return [];

    // Check GitHub for which are closed
    const [owner, repo] = ghRepo.split('/');
    const resolved: { issueNumber: number; title: string; issueUrl: string }[] = [];

    for (const sub of submissions) {
      try {
        const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: sub.issueNumber });
        if (data.state === 'closed') {
          resolved.push({ issueNumber: sub.issueNumber, title: sub.title, issueUrl: sub.issueUrl });
        }
      } catch {
        // Issue may have been deleted; skip
      }
    }

    return resolved;
  })

  .post('/api/feedback/:issueNumber/acknowledge', ({ params, user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }

    db.update(schema.feedbackSubmissions)
      .set({ acknowledgedAt: new Date().toISOString() })
      .where(and(
        eq(schema.feedbackSubmissions.userId, parseInt(user.id)),
        eq(schema.feedbackSubmissions.issueNumber, parseInt(params.issueNumber)),
      ))
      .run();

    return { success: true };
  })

  .get('/api/admin/issues', async ({ user, set, query }) => {
    // Dev-only: feedback triage (GitHub issue list) is not for admins.
    if (!isDev(user)) { set.status = 403; return { error: 'Forbidden' }; }
    if (!octokit || !ghRepo) { set.status = 503; return { error: 'Feedback not configured' }; }

    const [owner, repo] = ghRepo.split('/');
    const state = (query as any)?.state === 'closed' ? 'closed' as const : (query as any)?.state === 'all' ? 'all' as const : 'open' as const;

    try {
      const { data } = await octokit.rest.issues.listForRepo({
        owner, repo,
        labels: 'feedback',
        state,
        per_page: 50,
        sort: 'created',
        direction: 'desc',
      });
      return data.map(issue => ({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: issue.labels.map(l => typeof l === 'string' ? l : l.name),
        createdAt: issue.created_at,
        closedAt: issue.closed_at,
        url: issue.html_url,
      }));
    } catch (e: any) {
      console.error('GitHub issues fetch failed:', e.message);
      set.status = 502;
      return { error: 'Failed to fetch issues' };
    }
  });
