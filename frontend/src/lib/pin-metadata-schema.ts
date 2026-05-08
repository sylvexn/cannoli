/**
 * Per-pin metadata field schema. The minter (`mintManualPins` in
 * backend/src/lib/pins/awards-data.ts) and admin award flow stash a small
 * JSON blob on each pin (`pokemon`, `nickname`, `leagueId`, `teamId`); this
 * map tells the UI which of those fields to render in tooltips, recent-
 * award rows, and the trophy case for a given pin definition.
 *
 * Keep in sync with the resolver branches in `mintManualPins` — adding a new
 * pin that carries metadata means listing its fields here and teaching the
 * minter (or the manual award dialog) to populate them.
 */
export type PinMetadataField = 'pokemon' | 'nickname' | 'leagueId' | 'teamId';

export const PIN_METADATA_SCHEMA: Record<string, readonly PinMetadataField[]> = {
  // Best Nickname — needs both the mon and the nickname text.
  rotom: ['pokemon', 'nickname'],

  // Mon-headlined awards — recipient is the team owner, so the mon is the
  // headline detail to render.
  dragapult: ['pokemon'],
  florges: ['pokemon'],
  charizard: ['pokemon'],
  pikachu: ['pokemon'],

  // Coach-headlined per-league awards — the league is the only metadata
  // worth surfacing (recipient is the user).
  cannoli: ['leagueId'],
  cynthia: ['leagueId'],
  'best-draft': ['leagueId'],
};

/** Resolve schema for a pin id; falls back to no fields. */
export function pinMetadataFields(pinDefId: string): readonly PinMetadataField[] {
  return PIN_METADATA_SCHEMA[pinDefId] ?? [];
}

/**
 * Render a metadata blob into a compact string per pin schema. Returns
 * `null` when there's nothing meaningful to show (e.g. pin schema is empty,
 * or the metadata blob is missing the required fields).
 *
 * Examples:
 *   rotom:    `“Furious George” — Garchomp`
 *   dragapult/florges/charizard/pikachu: `Garchomp`
 *   cannoli/cynthia/best-draft: (nothing — leagueId is rendered as a chip
 *     by callers that have league lookup data, not a plain string here)
 */
export function formatPinMetadata(
  pinDefId: string,
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const fields = pinMetadataFields(pinDefId);
  if (fields.length === 0) return null;

  const pokemon = typeof metadata.pokemon === 'string' ? metadata.pokemon : null;
  const nickname = typeof metadata.nickname === 'string' ? metadata.nickname : null;

  if (pinDefId === 'rotom') {
    if (nickname && pokemon) return `“${nickname}” — ${pokemon}`;
    if (nickname) return `“${nickname}”`;
    if (pokemon) return pokemon;
    return null;
  }

  if (fields.includes('pokemon') && pokemon) return pokemon;
  return null;
}
