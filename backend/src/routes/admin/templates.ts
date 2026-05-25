import { Elysia } from 'elysia';
import { db, schema } from '../../db';
import { eq, desc } from 'drizzle-orm';
import { requireStaff } from '../../lib/auth-guards';

const ALLOWED_FORMATS = [
  'gen9natdex', 'gen9ou', 'gen9uu', 'gen9ru', 'gen9nu', 'gen9pu', 'gen9lc', 'gen9ubers',
] as const;

interface TemplateBody {
  name?: string;
  description?: string | null;
  format?: string;
  tierListSnapshot?: unknown;
  banlist?: unknown;
  teraBanlist?: unknown;
  captainCount?: number;
  pointCap?: number;
  rosterSize?: number;
}

function jsonStringify(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v ?? null);
}

function rowToJson(row: typeof schema.draftTemplates.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    format: row.format,
    tierListSnapshot: safeParse(row.tierListSnapshot, []),
    banlist: safeParse(row.banlist, []),
    teraBanlist: safeParse(row.teraBanlist, []),
    captainCount: row.captainCount,
    pointCap: row.pointCap,
    rosterSize: row.rosterSize,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

function safeParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; }
  catch { return fallback; }
}

export const templateAdminRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // ─── List templates ─────────────────────────────────────────────────
  .get('/api/draft-templates', ({ user, set }) => {
    const rows = db.select().from(schema.draftTemplates)
      .orderBy(desc(schema.draftTemplates.createdAt))
      .all();
    return rows.map(rowToJson);
  })

  // ─── Get single ─────────────────────────────────────────────────────
  .get('/api/draft-templates/:id', ({ params, user, set }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) { set.status = 400; return { error: 'Invalid id' }; }
    const row = db.select().from(schema.draftTemplates).where(eq(schema.draftTemplates.id, id)).get();
    if (!row) { set.status = 404; return { error: 'Template not found' }; }
    return rowToJson(row);
  })

  // ─── Create ─────────────────────────────────────────────────────────
  .post('/api/draft-templates', ({ body, user, set }) => {
    const b = body as TemplateBody;
    const name = b.name?.trim();
    if (!name) { set.status = 400; return { error: 'name required' }; }
    const format = b.format ?? 'gen9natdex';
    if (!ALLOWED_FORMATS.includes(format as (typeof ALLOWED_FORMATS)[number])) {
      set.status = 400; return { error: `format must be one of ${ALLOWED_FORMATS.join(', ')}` };
    }
    if (!b.tierListSnapshot) { set.status = 400; return { error: 'tierListSnapshot required' }; }

    const result = db.insert(schema.draftTemplates).values({
      name,
      description: b.description ?? null,
      format,
      tierListSnapshot: jsonStringify(b.tierListSnapshot),
      banlist: jsonStringify(b.banlist ?? []),
      teraBanlist: jsonStringify(b.teraBanlist ?? []),
      captainCount: Number.isInteger(b.captainCount) ? b.captainCount! : 2,
      pointCap: Number.isInteger(b.pointCap) ? b.pointCap! : 110,
      rosterSize: Number.isInteger(b.rosterSize) ? b.rosterSize! : 11,
      createdBy: parseInt(user.id),
    }).returning().get();

    db.insert(schema.activityLog).values({
      type: 'draft_template_created',
      category: 'config',
      actor: user.username,
      description: `Created draft template "${name}"`,
      metadata: JSON.stringify({ templateId: result.id, format }),
    }).run();

    return rowToJson(result);
  })

  // ─── Update ─────────────────────────────────────────────────────────
  .put('/api/draft-templates/:id', ({ params, body, user, set }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) { set.status = 400; return { error: 'Invalid id' }; }
    const existing = db.select().from(schema.draftTemplates).where(eq(schema.draftTemplates.id, id)).get();
    if (!existing) { set.status = 404; return { error: 'Template not found' }; }
    const b = body as TemplateBody;

    const updates: Record<string, unknown> = {};
    if (b.name !== undefined) {
      const n = b.name?.trim();
      if (!n) { set.status = 400; return { error: 'name cannot be empty' }; }
      updates.name = n;
    }
    if (b.description !== undefined) updates.description = b.description;
    if (b.format !== undefined) {
      if (!ALLOWED_FORMATS.includes(b.format as (typeof ALLOWED_FORMATS)[number])) {
        set.status = 400; return { error: `format must be one of ${ALLOWED_FORMATS.join(', ')}` };
      }
      updates.format = b.format;
    }
    if (b.tierListSnapshot !== undefined) updates.tierListSnapshot = jsonStringify(b.tierListSnapshot);
    if (b.banlist !== undefined) updates.banlist = jsonStringify(b.banlist);
    if (b.teraBanlist !== undefined) updates.teraBanlist = jsonStringify(b.teraBanlist);
    if (b.captainCount !== undefined) updates.captainCount = Number(b.captainCount);
    if (b.pointCap !== undefined) updates.pointCap = Number(b.pointCap);
    if (b.rosterSize !== undefined) updates.rosterSize = Number(b.rosterSize);

    if (Object.keys(updates).length === 0) {
      return rowToJson(existing);
    }

    db.update(schema.draftTemplates).set(updates).where(eq(schema.draftTemplates.id, id)).run();
    const updated = db.select().from(schema.draftTemplates).where(eq(schema.draftTemplates.id, id)).get()!;
    return rowToJson(updated);
  })

  // ─── Delete ─────────────────────────────────────────────────────────
  .delete('/api/draft-templates/:id', ({ params, user, set }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) { set.status = 400; return { error: 'Invalid id' }; }
    const existing = db.select().from(schema.draftTemplates).where(eq(schema.draftTemplates.id, id)).get();
    if (!existing) { set.status = 404; return { error: 'Template not found' }; }

    db.delete(schema.draftTemplates).where(eq(schema.draftTemplates.id, id)).run();
    db.insert(schema.activityLog).values({
      type: 'draft_template_deleted',
      category: 'config',
      actor: user.username,
      description: `Deleted draft template "${existing.name}"`,
      metadata: JSON.stringify({ templateId: id }),
    }).run();

    return { success: true };
  });
