/**
 * Regenerate `frontend/src/data/tier-list.ts` from `backend/imports/Costs.xlsx`.
 *
 *   bun run scripts/gen-tier-list.ts
 *
 * The frontend static tier list is the cost authority for every draft / roster /
 * free-agent surface, so it must stay byte-for-byte in sync with the same sheet
 * that drives the backend `pokemon` table (see `apply-s11-costs.ts`). Both read
 * `parse-costs.ts`, so a single sheet edit + re-run keeps them aligned.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseCosts } from './parse-costs';

const OUT = resolve(import.meta.dir, '../../frontend/src/data/tier-list.ts');

const { tiers, banned, teraBanned } = parseCosts();

const quote = (names: string[]): string =>
  names.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(',');

const bannedSrc = quote(banned);
const teraBannedSrc = quote(teraBanned);

const tierNums = [...tiers.keys()].sort((a, b) => b - a); // 20 → 1
const tiersSrc = tierNums.map((t) => `  [${t}, [${quote(tiers.get(t)!)}]],`).join('\n');

const file = `/**
 * Full tier list — GENERATED from backend/imports/Costs.xlsx (NatDex+ sheet).
 * Do not hand-edit: re-run \`bun run scripts/gen-tier-list.ts\` from backend/.
 * Categories: Banned, Tera Banned, and tiers 20 → 1.
 * Tera cost schedule included for captain cost computation.
 */


export interface TierEntry {
  name: string;
  tier: number;
  /** Cost when designated as a tera captain. Same as tier for 10pt+, higher for 9pt and below. */
  teraCost: number;
  /** Whether this Pokemon is banned from being a tera captain */
  teraBanned: boolean;
}

// ─── Tera cost schedule (tiers 9 and below cost more as captains) ───
const TERA_COST_MAP: Record<number, number> = {
  9: 12, 8: 10, 7: 9, 6: 8, 5: 6, 4: 5, 3: 4, 2: 2, 1: 1,
};

export function getTermCost(baseTier: number): number {
  return TERA_COST_MAP[baseTier] ?? baseTier;
}

// ─── Banned Pokemon (not draftable) ─────────────────────────────
export const BANNED: string[] = [
  ${bannedSrc},
];

// ─── Tera Banned (can be drafted, cannot be tera captain) ────────
export const TERA_BANNED: string[] = [
  ${teraBannedSrc},
];

// ─── Full tier list (20pt → 1pt) ────────────────────────────────
const TIERS_RAW: [number, string[]][] = [
${tiersSrc}
];

// Build the full tier list as a flat array
export const TIER_LIST: TierEntry[] = TIERS_RAW.flatMap(([tier, names]) =>
  names.map(name => ({
    name,
    tier,
    teraCost: TERA_COST_MAP[tier] ?? tier,
    teraBanned: TERA_BANNED.includes(name),
  }))
);

// Quick lookup by name
const tierMap = new Map<string, TierEntry>();
for (const entry of TIER_LIST) tierMap.set(entry.name, entry);
export function getTierEntry(name: string): TierEntry | undefined {
  return tierMap.get(name);
}

/** Get the effective point cost for a Pokemon on a roster */
export function getEffectiveCost(name: string, isTeraCaptain: boolean): number {
  const entry = tierMap.get(name);
  if (!entry) return 0;
  return isTeraCaptain ? entry.teraCost : entry.tier;
}

/** Check if a Pokemon can be a tera captain (tiers 1-9 only, not tera-banned) */
export function canBeTeraCaptain(name: string): boolean {
  const entry = tierMap.get(name);
  if (!entry) return false;
  if (entry.teraBanned) return false;
  if (entry.tier > 9) return false;
  return true;
}

/** Total Pokemon in tier list */
export const TIER_LIST_SIZE = TIER_LIST.length;
`;

writeFileSync(OUT, file);
console.log(
  `Wrote ${OUT}\n  tiers ${tierNums[tierNums.length - 1]}–${tierNums[0]}, ` +
    `${[...tiers.values()].reduce((a, b) => a + b.length, 0)} draftable, ` +
    `${banned.length} banned, ${teraBanned.length} tera-banned`,
);
