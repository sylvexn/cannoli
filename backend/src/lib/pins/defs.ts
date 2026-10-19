/** Shared pin-definition helpers: the declared metadata inputs and scopes. */
import type { schema } from '../../db';

export const PIN_SCOPES = ['league', 'season', 'team', 'match'] as const;
export type PinScope = (typeof PIN_SCOPES)[number];

/** Inputs an award can collect; declared per definition in `metadata_fields`. */
export const METADATA_FIELDS = ['pokemon', 'nickname', 'match', 'note'] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

export function parseMetadataFields(raw: string | null | undefined): MetadataField[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v)
      ? v.filter((f): f is MetadataField => (METADATA_FIELDS as readonly string[]).includes(f))
      : [];
  } catch { return []; }
}

/** Validate an incoming metadataFields value; returns the cleaned array or an error. */
export function checkMetadataFields(v: unknown): { fields: MetadataField[] } | { error: string } {
  if (!Array.isArray(v) || v.some(f => !(METADATA_FIELDS as readonly string[]).includes(f))) {
    return { error: `metadataFields must be an array of: ${METADATA_FIELDS.join(', ')}` };
  }
  return { fields: [...new Set(v)] as MetadataField[] };
}

type DefRow = typeof schema.pinDefinitions.$inferSelect;
/** Wire shape of a definition: metadataFields parsed from its JSON column. */
export function serializeDef<T extends Pick<DefRow, 'metadataFields'>>(d: T) {
  return { ...d, metadataFields: parseMetadataFields(d.metadataFields) };
}
