import { Elysia } from 'elysia';
import { Octokit } from 'octokit';
import { isStaff } from '../lib/auth';

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
      return { success: true, issueNumber: data.number, issueUrl: data.html_url };
    } catch (e: any) {
      console.error('GitHub issue creation failed:', e.message);
      set.status = 502;
      return { error: 'Failed to create issue' };
    }
  })

  .get('/api/admin/issues', async ({ user, set, query }) => {
    if (!isStaff(user)) { set.status = 403; return { error: 'Forbidden' }; }
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
