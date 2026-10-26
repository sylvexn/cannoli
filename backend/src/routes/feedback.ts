import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { alertFeedback } from '../lib/alert';
import { isR2Configured, r2Put, r2PublicUrl } from '../lib/r2';
import { writeUpload } from '../lib/uploads';
import { createTicketFromFeedback } from '../lib/tickets';

const VALID_CATEGORIES = ['bug', 'feature', 'league', 'general'] as const;
type FeedbackCategory = typeof VALID_CATEGORIES[number];

export const feedbackRoutes = new Elysia()

  // POST /api/feedback
  // Multipart form. Fields: category, title, description, optional page,
  // optional errorRef, optional screenshot (File).
  // Inserts a `feedback` row plus a linked ticket (CAN-n) and pings Discord.
  // No GitHub issue is created any more. Does NOT write feedbackSubmissions.

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

    // Screenshot upload (best-effort)
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

    // Insert feedback row
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

    const ticketId = createTicketFromFeedback({
      feedbackId, userId: parseInt(user.id), category, title, body: description, page, screenshotPath,
    });

    alertFeedback({
      title: `CAN-${ticketId}: ${title}`,
      description,
      page,
      reporter: user.username,
      role: user.role,
      errorRef,
      category,
    });

    return { success: true, id: feedbackId, ticketId };
  })

  // Retired: resolution notifications now come from ticket status moves
  // (lib/tickets.ts). Kept as a no-op because the client still calls it on login.
  .get('/api/feedback/notifications', ({ user, set }) => {
    if (!user) { set.status = 401; return { error: 'Not authenticated' }; }
    return { notified: 0 };
  });
