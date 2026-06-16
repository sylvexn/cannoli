/**
 * Single source of truth for Season 11 draft costs.
 *
 * Parses `backend/imports/Costs.xlsx` (the NatDex+ cost sheet) into the three
 * lists the rest of the platform needs: per-tier point costs, the banned
 * (un-draftable) set, and the tera-captain ban set.
 *
 * Two consumers share this derivation so the frontend static tier list and the
 * backend `pokemon` reference table can never drift:
 *   - `gen-tier-list.ts`   → regenerates `frontend/src/data/tier-list.ts`
 *   - `apply-s11-costs.ts` → updates the `pokemon` table on a live DB
 *
 * S11 uses the **NatDex+** sheet (legendaries / paradoxes allowed). The sheet
 * encodes two facts per species:
 *   - base "Pts" (col B): the draft cost. `99` is the sentinel for "banned"
 *     (not draftable).
 *   - a sibling "<name> (T)" row whose Pts is the cost AS a tera captain. `133`
 *     is the sentinel for "cannot be a tera captain". A "Tera Banned" mark (col
 *     C, value "TB") on the base row means the same thing.
 *
 * So a species is tera-captain-banned iff it is draftable (base ≤ 20, not 99),
 * captain-eligible by tier (≤ 9), and either TB-marked or its (T) cost is the
 * 133 sentinel (or the (T) row is missing entirely).
 */

import XLSX from 'xlsx';
import { resolve } from 'path';

export const COSTS_XLSX = resolve(import.meta.dir, '../imports/Costs.xlsx');

/** Point value used in the sheet to mean "not draftable". */
const BANNED_PTS = 99;
/** Captain (T) cost used in the sheet to mean "cannot be a tera captain". */
const NO_CAPTAIN_PTS = 133;
/** Captains are capped at tier 9 and below (league rule). */
const MAX_CAPTAIN_TIER = 9;

export interface CostEntry {
  name: string;
  /** Draft point cost (1–20). */
  tier: number;
  /** Not draftable. */
  banned: boolean;
  /** Draftable, but cannot be designated a tera captain. */
  teraBanned: boolean;
}

export interface ParsedCosts {
  /** Every draftable species (tier 1–20), keyed by name. */
  byName: Map<string, CostEntry>;
  /** tier number → species names, tiers present sorted ascending. */
  tiers: Map<number, string[]>;
  /** Un-draftable species names, sorted. */
  banned: string[];
  /** Draftable-but-not-captain species names, sorted. */
  teraBanned: string[];
}

const stripTera = (name: string): string => name.replace(/\s*\(T\)\s*$/, '').trim();
const isTeraRow = (name: string): boolean => /\(T\)\s*$/.test(name);

export function parseCosts(xlsxPath: string = COSTS_XLSX): ParsedCosts {
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets['NatDex+'];
  if (!ws) throw new Error(`Costs.xlsx is missing the "NatDex+" sheet (found: ${wb.SheetNames.join(', ')})`);
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });

  const basePts = new Map<string, number>();
  const tbMark = new Set<string>();
  const captainPts = new Map<string, number>();

  // Row 0 = sheet title, row 1 = column headers; data starts at row 2.
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || typeof r[0] !== 'string') continue;
    const raw = r[0].trim();
    if (!raw) continue;
    const pts = parseInt(r[1], 10);
    if (!Number.isFinite(pts)) continue;
    if (isTeraRow(raw)) {
      captainPts.set(stripTera(raw), pts);
    } else {
      basePts.set(raw, pts);
      if (String(r[2] ?? '').trim() === 'TB') tbMark.add(raw);
    }
  }

  const byName = new Map<string, CostEntry>();
  const tiers = new Map<number, string[]>();
  const banned: string[] = [];
  const teraBanned: string[] = [];

  for (const [name, pts] of basePts) {
    if (pts === BANNED_PTS) {
      banned.push(name);
      continue;
    }
    const captainEligibleByTier = pts <= MAX_CAPTAIN_TIER;
    const captainCost = captainPts.get(name);
    const cannotCaptain =
      tbMark.has(name) || captainCost === NO_CAPTAIN_PTS || captainCost === undefined;
    const isTeraBanned = captainEligibleByTier && cannotCaptain;

    byName.set(name, { name, tier: pts, banned: false, teraBanned: isTeraBanned });
    if (!tiers.has(pts)) tiers.set(pts, []);
    tiers.get(pts)!.push(name);
    if (isTeraBanned) teraBanned.push(name);
  }

  for (const list of tiers.values()) list.sort((a, b) => a.localeCompare(b));
  banned.sort((a, b) => a.localeCompare(b));
  teraBanned.sort((a, b) => a.localeCompare(b));

  return { byName, tiers, banned, teraBanned };
}
