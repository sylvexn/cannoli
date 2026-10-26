/**
 * Pure league-rules module shared by backend and frontend. No DB, no React.
 * A `Ruleset` is the parsed form of a `rulesets` row. Prices/bans stay in
 * `format_costs` (the ruleset only names the cost format).
 */

/** Tera captain cost markup: base cost -> captain cost. A key present = captain-eligible. */
export type TeraMarkup = Record<number, number>;

export const DEFAULT_MARKUP: Readonly<TeraMarkup> = Object.freeze({
  9: 12, 8: 10, 7: 9, 6: 8, 5: 6, 4: 5, 3: 4, 2: 2, 1: 1,
});

export interface Ruleset {
  id?: number;
  name: string;
  costFormat: string;
  pointCap: number;
  /** Draft rounds. */
  rosterSize: number;
  /** NULL = rosterSize (historic behaviour). */
  rosterMin: number | null;
  rosterMax: number | null;
  /** NULL = unlimited, 0 = no megas (primals count as megas). */
  megaCap: number | null;
  teraEnabled: boolean;
  teraCaptainSlots: number;
  teraTypesPerCaptain: number;
  teraMarkup: TeraMarkup;
}

export const DEFAULT_RULESET: Readonly<Ruleset> = Object.freeze({
  name: 'Default — NatDex+',
  costFormat: 'natdexplus',
  pointCap: 110,
  rosterSize: 10,
  rosterMin: null,
  rosterMax: null,
  megaCap: 1,
  teraEnabled: true,
  teraCaptainSlots: 2,
  teraTypesPerCaptain: 3,
  teraMarkup: DEFAULT_MARKUP,
});

/** Parse the JSON markup column; falls back to the standard table on junk. */
export function parseMarkup(raw: unknown): TeraMarkup {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return { ...DEFAULT_MARKUP }; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_MARKUP };
  const out: TeraMarkup = {};
  for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
    const tier = Number(k);
    if (Number.isInteger(tier) && tier >= 1 && typeof c === 'number' && Number.isFinite(c) && c >= 0) out[tier] = c;
  }
  return out;
}

/** Cost a mon contributes to the team total (captain markup only when tera is on). */
export function markupCost(rs: Pick<Ruleset, 'teraEnabled' | 'teraMarkup'>, cost: number, isCaptain: boolean): number {
  if (!isCaptain || !rs.teraEnabled) return cost;
  return rs.teraMarkup[cost] ?? cost;
}

/** Tier present in the markup table + not tera-banned (+ tera enabled). */
export function captainEligible(
  rs: Pick<Ruleset, 'teraEnabled' | 'teraMarkup'>,
  mon: { tier: number; teraBanned?: boolean },
): boolean {
  return rs.teraEnabled && !mon.teraBanned && rs.teraMarkup[mon.tier] !== undefined;
}

/** Largest captain-eligible tier (the old hardcoded "<= 9"), 0 if none. */
export function captainMaxTier(rs: Pick<Ruleset, 'teraMarkup'>): number {
  return Math.max(0, ...Object.keys(rs.teraMarkup).map(Number));
}

/** Total points of a roster, applying captain markup. */
export function rosterCost(rs: Pick<Ruleset, 'teraEnabled' | 'teraMarkup'>, roster: { cost: number; isCaptain?: boolean }[]): number {
  return roster.reduce((s, r) => s + markupCost(rs, r.cost, !!r.isCaptain), 0);
}

/**
 * Worst-case extra points to designate `slots` captains from `roster`
 * (sum of the largest eligible markups). `slots` defaults to the ruleset's.
 */
export function captainHeadroomNeeded(
  rs: Pick<Ruleset, 'teraEnabled' | 'teraMarkup' | 'teraCaptainSlots'>,
  roster: { tier: number; teraBanned?: boolean }[],
  slots: number = rs.teraCaptainSlots,
): number {
  if (slots <= 0) return 0;
  const markups = roster
    .filter(r => captainEligible(rs, r))
    .map(r => Math.max(0, markupCost(rs, r.tier, true) - r.tier))
    .sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(slots, markups.length); i++) total += markups[i];
  return total;
}

/** Mega limit as a number (Infinity when unlimited). */
export function megaLimit(rs: Pick<Ruleset, 'megaCap'>): number {
  return rs.megaCap == null ? Infinity : rs.megaCap;
}

/**
 * Effective roster band. A per-league override wins over the ruleset's band,
 * which wins over rosterSize: `league.min ?? ruleset.min ?? rosterSize`.
 */
export function rosterBand(
  rs: Pick<Ruleset, 'rosterSize' | 'rosterMin' | 'rosterMax'>,
  override?: { min?: number | null; max?: number | null },
): { min: number; max: number } {
  return {
    min: override?.min ?? rs.rosterMin ?? rs.rosterSize,
    max: override?.max ?? rs.rosterMax ?? rs.rosterSize,
  };
}

/** Internal-consistency problems of a ruleset (empty = valid). */
export function validateRulesetShape(rs: Ruleset): string[] {
  const errs: string[] = [];
  const int = (n: unknown) => typeof n === 'number' && Number.isInteger(n);
  if (!rs.name?.trim()) errs.push('name required');
  if (!rs.costFormat?.trim()) errs.push('costFormat required');
  if (!int(rs.pointCap) || rs.pointCap < 1) errs.push('pointCap must be a positive integer');
  if (!int(rs.rosterSize) || rs.rosterSize < 1) errs.push('rosterSize must be a positive integer');
  const { min, max } = rosterBand(rs);
  if (rs.rosterMin != null && !int(rs.rosterMin)) errs.push('rosterMin must be an integer');
  if (rs.rosterMax != null && !int(rs.rosterMax)) errs.push('rosterMax must be an integer');
  if (min > rs.rosterSize || max < rs.rosterSize) errs.push('roster band must satisfy min <= rosterSize <= max');
  if (rs.megaCap != null && (!int(rs.megaCap) || rs.megaCap < 0)) errs.push('megaCap must be null or an integer >= 0');
  if (!int(rs.teraCaptainSlots) || rs.teraCaptainSlots < 0) errs.push('teraCaptainSlots must be an integer >= 0');
  if (!rs.teraEnabled && rs.teraCaptainSlots !== 0) errs.push('teraCaptainSlots must be 0 when tera is disabled');
  if (rs.teraCaptainSlots > rs.rosterSize) errs.push('teraCaptainSlots cannot exceed rosterSize');
  if (!int(rs.teraTypesPerCaptain) || rs.teraTypesPerCaptain < 0) errs.push('teraTypesPerCaptain must be an integer >= 0');
  return errs;
}
