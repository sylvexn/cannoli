/**
 * Regenerate `frontend/src/data/tier-list.ts` from `backend/imports/Costs.xlsx`.
 *
 *   bun run scripts/gen-tier-list.ts
 *
 * The frontend static tier list is the cost authority for every draft / roster /
 * free-agent surface, so it must stay in sync with the same sheets that drive the
 * backend `format_costs` table (see `apply-cost-formats.ts`). Both read
 * `parse-costs.ts`, so a single sheet edit + re-run keeps them aligned.
 *
 * Emits BOTH cost formats (natdex = Emerald, natdexplus = Ruby/Sapphire). The
 * format-agnostic exports (`TIER_LIST`, `BANNED`, `TERA_BANNED`, and the helpers
 * called without a format) default to natdexplus, preserving every existing
 * import; league-scoped surfaces pass the league's `costFormat`.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseCostFormat, FORMAT_SHEETS } from './parse-costs';

const OUT = resolve(import.meta.dir, '../../frontend/src/data/tier-list.ts');
const DEFAULT_FORMAT = 'natdexplus';
const FORMATS = Object.keys(FORMAT_SHEETS); // ['natdex', 'natdexplus']

const quote = (names: string[]): string =>
  names.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(',');

const parsed = Object.fromEntries(FORMATS.map((f) => [f, parseCostFormat(f)]));

function tiersSrc(format: string): string {
  const { tiers } = parsed[format];
  const tierNums = [...tiers.keys()].sort((a, b) => b - a); // 20 → 1
  return tierNums.map((t) => `    [${t}, [${quote(tiers.get(t)!)}]],`).join('\n');
}

const formatBlock = (format: string): string => `  ${JSON.stringify(format)}: {
    banned: [${quote(parsed[format].banned)}],
    teraBanned: [${quote(parsed[format].teraBanned)}],
    tiers: [
${tiersSrc(format)}
    ],
  },`;

const file = `/**
 * Full tier list — GENERATED from backend/imports/Costs.xlsx.
 * Do not hand-edit: re-run \`bun run scripts/gen-tier-list.ts\` from backend/.
 *
 * Two cost formats: 'natdex' (Emerald) and 'natdexplus' (Ruby/Sapphire). The
 * format-agnostic exports (TIER_LIST/BANNED/TERA_BANNED and helpers called
 * without a format) default to '${DEFAULT_FORMAT}'.
 */

export type CostFormat = ${FORMATS.map((f) => `'${f}'`).join(' | ')};
export const COST_FORMATS: CostFormat[] = [${FORMATS.map((f) => `'${f}'`).join(', ')}];
export const DEFAULT_FORMAT: CostFormat = '${DEFAULT_FORMAT}';

export interface TierEntry {
  name: string;
  tier: number;
  /** Cost when designated as a tera captain. Same as tier for 10pt+, higher for 9pt and below. */
  teraCost: number;
  /** Whether this Pokemon is banned from being a tera captain */
  teraBanned: boolean;
}

// Tera cost schedule (tiers 9 and below cost more as captains)
const TERA_COST_MAP: Record<number, number> = {
  9: 12, 8: 10, 7: 9, 6: 8, 5: 6, 4: 5, 3: 4, 2: 2, 1: 1,
};

export function getTermCost(baseTier: number): number {
  return TERA_COST_MAP[baseTier] ?? baseTier;
}

// Raw per-format data
interface FormatData { banned: string[]; teraBanned: string[]; tiers: [number, string[]][]; }
const FORMAT_DATA: Record<CostFormat, FormatData> = {
${FORMATS.map(formatBlock).join('\n')}
};

interface BuiltFormat {
  tierList: TierEntry[];
  banned: string[];
  teraBanned: string[];
  byName: Map<string, TierEntry>;
}

function build(data: FormatData): BuiltFormat {
  const teraBannedSet = new Set(data.teraBanned);
  const tierList = data.tiers.flatMap(([tier, names]) =>
    names.map((name) => ({
      name,
      tier,
      teraCost: TERA_COST_MAP[tier] ?? tier,
      teraBanned: teraBannedSet.has(name),
    })),
  );
  const byName = new Map<string, TierEntry>();
  for (const e of tierList) byName.set(e.name, e);
  return { tierList, banned: data.banned, teraBanned: data.teraBanned, byName };
}

const BUILT: Record<CostFormat, BuiltFormat> = Object.fromEntries(
  COST_FORMATS.map((f) => [f, build(FORMAT_DATA[f])]),
) as Record<CostFormat, BuiltFormat>;

function fmt(format?: CostFormat): BuiltFormat {
  return BUILT[format ?? DEFAULT_FORMAT] ?? BUILT[DEFAULT_FORMAT];
}

// Per-format accessors
export function getTierList(format?: CostFormat): TierEntry[] { return fmt(format).tierList; }
export function getBanned(format?: CostFormat): string[] { return fmt(format).banned; }
export function getTeraBanned(format?: CostFormat): string[] { return fmt(format).teraBanned; }

export function getTierEntry(name: string, format?: CostFormat): TierEntry | undefined {
  return fmt(format).byName.get(name);
}

/** Get the effective point cost for a Pokemon on a roster */
export function getEffectiveCost(name: string, isTeraCaptain: boolean, format?: CostFormat): number {
  const entry = fmt(format).byName.get(name);
  if (!entry) return 0;
  return isTeraCaptain ? entry.teraCost : entry.tier;
}

/** Check if a Pokemon can be a tera captain (tiers 1-9 only, not tera-banned) */
export function canBeTeraCaptain(name: string, format?: CostFormat): boolean {
  const entry = fmt(format).byName.get(name);
  if (!entry) return false;
  if (entry.teraBanned) return false;
  if (entry.tier > 9) return false;
  return true;
}

// Format-agnostic exports (default '${DEFAULT_FORMAT}')
export const TIER_LIST: TierEntry[] = BUILT[DEFAULT_FORMAT].tierList;
export const BANNED: string[] = BUILT[DEFAULT_FORMAT].banned;
export const TERA_BANNED: string[] = BUILT[DEFAULT_FORMAT].teraBanned;

/** Total Pokemon in the default-format tier list */
export const TIER_LIST_SIZE = TIER_LIST.length;
`;

writeFileSync(OUT, file);
const counts = FORMATS.map((f) => {
  const { tiers, banned, teraBanned } = parsed[f];
  const draftable = [...tiers.values()].reduce((a, b) => a + b.length, 0);
  return `${f}: ${draftable} draftable, ${banned.length} banned, ${teraBanned.length} tera-banned`;
});
console.log(`Wrote ${OUT}\n  ${counts.join('\n  ')}`);
