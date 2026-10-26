/**
 * Patch notes core — structured "What's New" entries.
 *
 * A patch = version + date + title (theme) + sections (New / Changes / Fixes /
 * Balance) + optional hero image. Hotfixes (1.3.1) are rows whose `parent_id`
 * points at their patch (1.3) and render nested under it. Unread state is one
 * pulse per NEW top-level published patch newer than `changelog_seen_at`.
 */
import { db, schema } from '../db';
import { and, eq, desc, isNull, sql } from 'drizzle-orm';

export type SectionKind = 'new' | 'changes' | 'fixes' | 'balance';
export interface PatchSection { kind: SectionKind; items: string[] }

export const SECTION_KINDS: SectionKind[] = ['new', 'changes', 'fixes', 'balance'];

export interface PatchNote {
  id: string;
  version: string | null;
  date: string;
  title: string;
  heroUrl: string | null;
  sections: PatchSection[];
  parentId: string | null;
  status: 'draft' | 'published';
}
export interface PatchWithHotfixes extends PatchNote { hotfixes: PatchNote[] }

/** Legacy tag -> section. */
const TAG_TO_KIND: Record<string, SectionKind> = { feature: 'new', improvement: 'changes', fix: 'fixes' };

/**
 * Parse the legacy dashed body ("- text (feature|fix|improvement)") into sections.
 * Untagged lines (and continuation lines) land in Changes. Empty sections dropped.
 */
export function parseLegacyBody(body: string | null | undefined): PatchSection[] {
  const buckets: Record<SectionKind, string[]> = { new: [], changes: [], fixes: [], balance: [] };
  for (const raw of (body ?? '').split('\n')) {
    let line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    let kind: SectionKind = 'changes';
    const m = line.match(/\s*\((feature|improvement|fix)\)\s*$/i);
    if (m) {
      kind = TAG_TO_KIND[m[1]!.toLowerCase()]!;
      line = line.slice(0, m.index).trim();
    }
    if (line) buckets[kind].push(line);
  }
  return SECTION_KINDS.filter(k => buckets[k].length).map(k => ({ kind: k, items: buckets[k] }));
}

/** "Cannoli v1.0.8 — Theme" / "Cannoli 1.0 — Day 1 patch" -> { version, theme }. */
export function parseLegacyTitle(title: string): { version: string | null; theme: string } {
  const m = title.match(/^Cannoli\s+v?(\d+(?:\.\d+){1,2})\s*[—–-]\s*(.+)$/);
  return m ? { version: m[1]!, theme: m[2]!.trim() } : { version: null, theme: title };
}

/** Validate/normalise client-supplied sections; returns null when malformed. */
export function normalizeSections(input: unknown): PatchSection[] | null {
  if (!Array.isArray(input)) return null;
  const out: PatchSection[] = [];
  for (const s of input) {
    if (!s || typeof s !== 'object') return null;
    const { kind, items } = s as { kind?: unknown; items?: unknown };
    if (!SECTION_KINDS.includes(kind as SectionKind) || !Array.isArray(items)) return null;
    const clean = items.filter((i): i is string => typeof i === 'string').map(i => i.trim()).filter(Boolean);
    if (clean.length) out.push({ kind: kind as SectionKind, items: clean });
  }
  return out;
}

/** Entry-level badge column (still NOT NULL) derived from the sections. */
export function deriveCategory(sections: PatchSection[]): 'feature' | 'improvement' | 'fix' {
  const kinds = new Set(sections.map(s => s.kind));
  if (kinds.size === 1 && kinds.has('fixes')) return 'fix';
  if (kinds.has('new') && !kinds.has('changes')) return 'feature';
  return 'improvement';
}

function parseSections(raw: string | null): PatchSection[] {
  if (!raw) return [];
  try { return normalizeSections(JSON.parse(raw)) ?? []; } catch { return []; }
}

type Row = typeof schema.changelog.$inferSelect;
export function toPatchNote(r: Row): PatchNote {
  return {
    id: r.id, version: r.version, date: r.date, title: r.title, heroUrl: r.heroUrl,
    sections: parseSections(r.sections), parentId: r.parentId, status: r.status,
  };
}

/**
 * One-time (idempotent) conversion of pre-0073 rows: split the title into
 * version + theme, parse the dashed body into sections, nest x.y.z hotfixes
 * under their x.y patch. Only touches rows with sections IS NULL, so published
 * edits and re-runs are never clobbered. `body` is left in place.
 */
export function migrateChangelogStructure(): number {
  const rows = db.select().from(schema.changelog).where(isNull(schema.changelog.sections)).all();
  if (rows.length === 0) return 0;
  const converted = new Map<string, string>(); // version -> id
  for (const r of rows) {
    const { version, theme } = parseLegacyTitle(r.title);
    db.update(schema.changelog).set({
      version: r.version ?? version,
      title: version ? theme : r.title,
      sections: JSON.stringify(parseLegacyBody(r.body)),
    }).where(eq(schema.changelog.id, r.id)).run();
    if (version) converted.set(version, r.id);
  }
  for (const [version, id] of converted) {
    const parts = version.split('.');
    if (parts.length !== 3) continue;
    const parent = converted.get(parts.slice(0, 2).join('.'));
    if (parent) db.update(schema.changelog).set({ parentId: parent }).where(eq(schema.changelog.id, id)).run();
  }
  return rows.length;
}

/** Published patches newest-first with hotfixes nested (newest-first). */
export function getPublishedPatches(): PatchWithHotfixes[] {
  const rows = db.select().from(schema.changelog)
    .where(eq(schema.changelog.status, 'published'))
    .orderBy(desc(schema.changelog.date)).all().map(toPatchNote);
  const kids = new Map<string, PatchNote[]>();
  for (const r of rows) if (r.parentId) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r]);
  return rows.filter(r => !r.parentId).map(r => ({ ...r, hotfixes: kids.get(r.id) ?? [] }));
}

/** Date of the newest published top-level patch (null when none). */
export function newestPatchDate(): string | null {
  const row = db.select({ d: sql<string | null>`max(${schema.changelog.date})` }).from(schema.changelog)
    .where(and(eq(schema.changelog.status, 'published'), isNull(schema.changelog.parentId))).get();
  return row?.d ?? null;
}

/** Unread = published top-level patches dated after the user's seen stamp. */
export function countUnreadPatches(seenAt: string | null): number {
  const conds = [eq(schema.changelog.status, 'published'), isNull(schema.changelog.parentId)];
  if (seenAt) conds.push(sql`${schema.changelog.date} > ${seenAt}`);
  return db.select({ n: sql<number>`count(*)` }).from(schema.changelog).where(and(...conds)).get()?.n ?? 0;
}

