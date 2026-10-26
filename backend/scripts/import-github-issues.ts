/**
 * One-time import of GitHub issues (open AND closed) into tickets.
 *
 *   GITHUB_TOKEN=... bun run scripts/import-github-issues.ts            # dry run
 *   GITHUB_TOKEN=... bun run scripts/import-github-issues.ts --apply    # write
 *
 * Ticket id = issue number (CAN-n). Idempotent on github_issue_number. Run it
 * BEFORE the first in-app ticket exists on the target DB, otherwise a new
 * ticket may already own an id the import wants (reported as a conflict, skipped).
 * Repo: GITHUB_REPO env or sylvexn/cannoli.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { parseReporterUsername } from '../src/lib/notifications/notify';

export interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  state_reason?: string | null;
  labels: Array<string | { name?: string }>;
  html_url: string;
  created_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

const WONT_FIX = new Set(['wontfix', "won't fix", 'invalid', 'duplicate']);
const labelNames = (i: GhIssue) => i.labels.map(l => (typeof l === 'string' ? l : l.name ?? '').toLowerCase());

export function mapStatus(i: GhIssue): 'new' | 'fixed' | 'wont_fix' {
  if (i.state === 'open') return 'new';
  return i.state_reason === 'not_planned' || labelNames(i).some(l => WONT_FIX.has(l)) ? 'wont_fix' : 'fixed';
}

export function importIssues(issues: GhIssue[], apply: boolean) {
  const out = { inserted: [] as number[], skipped: [] as number[], conflicts: [] as number[] };
  for (const i of issues) {
    if (i.pull_request) continue;
    const n = i.number;
    if (db.select({ i: schema.tickets.id }).from(schema.tickets).where(eq(schema.tickets.githubIssueNumber, n)).get()) { out.skipped.push(n); continue; }
    if (db.select({ i: schema.tickets.id }).from(schema.tickets).where(eq(schema.tickets.id, n)).get()) { out.conflicts.push(n); continue; }

    const fb = db.select().from(schema.feedback).where(eq(schema.feedback.githubIssueNumber, n)).get();
    const username = parseReporterUsername(i.body);
    const reporter = fb?.userId ?? (username
      ? db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.username}) = ${username.toLowerCase()}`).get()?.id ?? null
      : null);
    const status = mapStatus(i);
    out.inserted.push(n);
    if (!apply) continue;

    db.insert(schema.tickets).values({
      id: n, title: i.title, body: i.body ?? '', status,
      type: (fb ? fb.category === 'bug' : labelNames(i).includes('bug')) ? 'bug' : 'idea',
      reporterUserId: reporter, feedbackId: fb?.id ?? null,
      pageUrl: fb?.page ?? null, screenshotPath: fb?.screenshotPath ?? null,
      githubIssueNumber: n, githubUrl: i.html_url,
      createdAt: i.created_at, updatedAt: i.closed_at ?? i.created_at,
      closedAt: status === 'new' ? null : i.closed_at,
    }).run();
    db.insert(schema.ticketEvents).values({
      ticketId: n, kind: 'import', toStatus: status, text: `Imported from GitHub #${n}`, createdAt: i.created_at,
    }).run();
  }
  return out;
}

export async function fetchIssues(token: string, repo: string, fetchImpl: typeof fetch = fetch): Promise<GhIssue[]> {
  const all: GhIssue[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cannoli-import' },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
    const batch = await res.json() as GhIssue[];
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

if (import.meta.main) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.error('GITHUB_TOKEN env var required'); process.exit(1); }
  const apply = process.argv.includes('--apply');
  const issues = await fetchIssues(token, process.env.GITHUB_REPO ?? 'sylvexn/cannoli');
  const r = importIssues(issues, apply);
  console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${issues.length} fetched, ${r.inserted.length} to import, ${r.skipped.length} already imported, ${r.conflicts.length} id conflicts`);
  if (r.conflicts.length) console.log('conflicts (ticket id already used by a non-GitHub ticket):', r.conflicts.join(', '));
  if (!apply) console.log('Re-run with --apply to write.');
}
