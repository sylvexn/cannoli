/**
 * Draft Center rule checks. WARN, never block: the editor saves illegal teams
 * and renders these inline. Mirrors backend/src/lib/draft-center/rules.ts
 * (kept in step by tests on both sides) so the live editor and the server's
 * summary agree.
 */
import { getBanned, getEffectiveCost, getTierEntry, type CostFormat } from '@/data/tier-list';
import { getBaseFormName, isMegaForm } from '@/lib/draft-rules';
import type { Ruleset } from './ruleset';
import { MAX_CAPTAIN_TIER, type DcMon, type DcValidation, type DcViolation } from './types';

const bannedSets = new Map<CostFormat, Set<string>>();
function isBanned(name: string, format: CostFormat): boolean {
  let s = bannedSets.get(format);
  if (!s) { s = new Set(getBanned(format)); bannedSets.set(format, s); }
  return s.has(name);
}

/** Points a mon contributes (captain markup applied). Unknown species cost 0. */
export function monCost(m: Pick<DcMon, 'name' | 'captain'>, format: CostFormat): number {
  return getEffectiveCost(m.name, m.captain, format);
}

/** Base tier cost (no markup), or null when the species has no price. */
export function baseTier(name: string, format: CostFormat): number | null {
  return getTierEntry(name, format)?.tier ?? null;
}

/** Can this mon be designated a captain under the ruleset's format? */
export function captainEligibility(name: string, format: CostFormat): { ok: boolean; reason?: string } {
  const e = getTierEntry(name, format);
  if (!e) return { ok: false, reason: 'No price in this format' };
  if (e.teraBanned) return { ok: false, reason: 'Tera-banned' };
  if (e.tier > MAX_CAPTAIN_TIER) return { ok: false, reason: `Tier ${e.tier} — captains must be tier ${MAX_CAPTAIN_TIER} or below` };
  return { ok: true };
}

export function validateTeam(roster: DcMon[], rs: Ruleset): DcValidation {
  const v: DcViolation[] = [];
  let used = 0;
  const seen = new Map<string, string>();
  const megas: string[] = [];
  const fmt = rs.costFormat;

  for (const m of roster) {
    const e = getTierEntry(m.name, fmt);
    const banned = isBanned(m.name, fmt);
    if (banned) {
      v.push({ code: 'banned', severity: 'warn', pokemon: m.name, message: `${m.name} is banned in this format` });
    } else if (!e) {
      v.push({ code: 'unknown_pokemon', severity: 'warn', pokemon: m.name, message: `${m.name} has no price in this format` });
    }
    used += monCost(m, fmt);

    const base = getBaseFormName(m.name);
    const prev = seen.get(base);
    if (prev) v.push({ code: 'duplicate_species', severity: 'warn', pokemon: m.name, message: `${m.name} duplicates ${prev} (same National Dex number)` });
    else seen.set(base, m.name);

    if (isMegaForm(m.name)) megas.push(m.name);

    if (m.captain) {
      if (e && e.tier > MAX_CAPTAIN_TIER) {
        v.push({ code: 'captain_tier', severity: 'warn', pokemon: m.name, message: `${m.name} is tier ${e.tier}; captains must be tier ${MAX_CAPTAIN_TIER} or below` });
      }
      if (e?.teraBanned) {
        v.push({ code: 'captain_tera_banned', severity: 'warn', pokemon: m.name, message: `${m.name} is tera-banned and cannot be a captain` });
      }
      if (m.teraTypes.length > rs.teraTypesPerCaptain) {
        v.push({ code: 'tera_types_over', severity: 'warn', pokemon: m.name, message: `${m.name} has more than ${rs.teraTypesPerCaptain} tera types` });
      } else if (m.teraTypes.length < rs.teraTypesPerCaptain) {
        v.push({ code: 'captain_no_tera', severity: 'info', pokemon: m.name, message: `${m.name} has ${m.teraTypes.length}/${rs.teraTypesPerCaptain} tera types picked` });
      }
    }
  }

  const captains = roster.filter(m => m.captain).length;
  if (megas.length > 1) {
    v.push({ code: 'multi_mega', severity: 'warn', message: `${megas.length} Megas (${megas.join(', ')}); max 1 per team` });
  }
  if (captains > rs.teraCaptainSlots) {
    v.push({ code: 'captain_count', severity: 'warn', message: `${captains} captains; this ruleset allows ${rs.teraCaptainSlots}` });
  }
  if (roster.length > rs.rosterSize) {
    v.push({ code: 'roster_over', severity: 'warn', message: `${roster.length} Pokemon; roster size is ${rs.rosterSize}` });
  }
  if (used > rs.pointCap) {
    v.push({ code: 'over_budget', severity: 'warn', message: `${used} points used; budget is ${rs.pointCap}` });
  }

  return {
    used, budget: rs.pointCap, remaining: rs.pointCap - used,
    rosterSize: rs.rosterSize, count: roster.length, violations: v,
  };
}

/** Warnings only (info-level nudges excluded) — what the badge counts. */
export const warnCount = (v: DcValidation): number => v.violations.filter(x => x.severity === 'warn').length;
