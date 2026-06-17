/**
 * resolve-feedback.ts — close an in-app feedback item from the CLI, exactly as
 * the admin "resolve" action does: marks it resolved, stores the admin reply,
 * and notifies the reporter ("Your feedback "<title>" was resolved").
 *
 * Mirrors POST /api/admin/feedback/:id/resolve (src/routes/feedback.ts) so it
 * can run inside the live backend container without an admin session.
 *
 * NOTE: resolving notifies the reporter immediately — run this when the fix is
 * actually live, not before, so the "resolved" notification matches reality.
 *
 *   bun run scripts/resolve-feedback.ts                          # list open feedback
 *   bun run scripts/resolve-feedback.ts <id> "<reply>"           # dry-run preview
 *   bun run scripts/resolve-feedback.ts <id> "<reply>" --apply   # write + notify
 *   bun run scripts/resolve-feedback.ts <id> "<reply>" --apply --by <username>
 */
import { db, schema } from '../src/db';
import { eq, and, desc } from 'drizzle-orm';
import { notifyUser } from '../src/lib/notifications/notify';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const byIdx = argv.indexOf('--by');
const byUsername = byIdx >= 0 ? argv[byIdx + 1] : null;
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--by');

const idArg = positional[0];
const reply = positional[1] ?? null;

function listOpen() {
  const rows = db.select({
    id: schema.feedback.id,
    category: schema.feedback.category,
    title: schema.feedback.title,
    page: schema.feedback.page,
    createdAt: schema.feedback.createdAt,
    username: schema.users.username,
  })
    .from(schema.feedback)
    .leftJoin(schema.users, eq(schema.feedback.userId, schema.users.id))
    .where(eq(schema.feedback.status, 'open'))
    .orderBy(desc(schema.feedback.createdAt))
    .all();
  if (rows.length === 0) { console.log('No open feedback.'); return; }
  console.log(`Open feedback (${rows.length}):\n`);
  for (const r of rows) {
    console.log(`  #${r.id}  [${r.category}]  ${r.title}`);
    console.log(`        by ${r.username ?? '?'}  ·  ${r.page ?? 'no page'}  ·  ${r.createdAt ?? ''}`);
  }
  console.log(`\nResolve one:  bun run scripts/resolve-feedback.ts <id> "<reply>" --apply`);
}

if (!idArg) { listOpen(); process.exit(0); }

const id = parseInt(idArg);
if (!Number.isFinite(id)) { console.error(`Invalid id: ${idArg}`); process.exit(1); }

const row = db.select().from(schema.feedback).where(eq(schema.feedback.id, id)).get();
if (!row) { console.error(`Feedback #${id} not found.`); process.exit(1); }

const reporter = db.select({ username: schema.users.username })
  .from(schema.users).where(eq(schema.users.id, row.userId)).get();

let resolverId: number | null = null;
if (byUsername) {
  const u = db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.username, byUsername)).get();
  if (!u) { console.error(`--by user '${byUsername}' not found.`); process.exit(1); }
  resolverId = u.id;
}

console.log(`Feedback #${row.id}  [${row.category}]  "${row.title}"`);
console.log(`  status:    ${row.status}${row.status === 'resolved' ? ' (already resolved!)' : ''}`);
console.log(`  reporter:  ${reporter?.username ?? row.userId}`);
console.log(`  reply:     ${reply ?? '(none)'}`);
console.log(`  notify →   "Your feedback "${row.title}" was resolved"`);
console.log('');

if (!APPLY) {
  console.log('Dry-run only — add --apply to resolve and notify the reporter.');
  process.exit(0);
}

const now = new Date().toISOString();
db.update(schema.feedback).set({
  status: 'resolved',
  adminResponse: reply,
  resolvedByUserId: resolverId,
  resolvedAt: now,
}).where(eq(schema.feedback.id, id)).run();

notifyUser(row.userId, {
  type: 'feedback',
  title: `Your feedback "${row.title}" was resolved`,
  body: reply,
  link: row.githubIssueUrl ?? '/',
});

console.log(`Resolved #${id} and notified ${reporter?.username ?? row.userId}.`);
