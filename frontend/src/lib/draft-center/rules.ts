/**
 * Draft Center rule checks. WARN, never block: the editor saves illegal teams
 * and renders these inline. Mirrors backend/src/lib/draft-center/rules.ts
 * (kept in step by tests on both sides) so the live editor and the server's
 * summary agree.
 */
import { captainEligible, markupCost, megaLimit, rosterBand } from '@cannoli/rules';
import { getBanned, getTierEntry, type CostFormat } from '@/data/tier-list';
import { getBaseFormName, isMegaForm } from '@/lib/draft-rules';
import { rosterSizeOf, type Ruleset } from './ruleset';
import type { DcMon, DcValidation, DcViolation } from './types';

const bannedSets = new Map<CostFormat, Set<string>>();
function isBanned(name: string, format: CostFormat): boolean {
  let s = bannedSets.get(format);
  if (!s) { s = new Set(getBanned(format)); bannedSets.set(format, s); }
  return s.has(name);
}

/** Points a mon contributes (captain markup from the ruleset). Unknown species cost 0. */
export function monCost(m: Pick<DcMon, 'name' | 'captain'>, rs: Ruleset): number {
  const t = baseTier(m.name, rs.costFormat);
  return t == null ? 0 : markupCost(rs, t, m.captain);
}

/** Base tier cost (no markup), or null when the species has no price. */
export function baseTier(name: string, format: CostFormat): number | null {
  return getTierEntry(name, format)?.tier ?? null;
}

/** Can this mon be designated a captain under the ruleset? (tier in its markup table, not tera-banned) */
export function captainEligibility(name: string, rs: Ruleset): { ok: boolean; reason?: string } {
  const e = getTierEntry(name, rs.costFormat);
  if (!e) return { ok: false, reason: 'No price in this format' };
  if (!rs.teraEnabled) return { ok: false, reason: 'Tera captains are disabled in this ruleset' };
  if (e.teraBanned) return { ok: false, reason: 'Tera-banned' };
  if (!captainEligible(rs, e)) return { ok: false, reason: `Tier ${e.tier} is not captain-eligible in this ruleset` };
  return { ok: true };
}

export function validateTeam(roster: DcMon[], rs: Ruleset): DcValidation {
  const v: DcViolation[] = [];
  let used = 0;
  const seen = new Map<string, string>();
  const megas: string[] = [];
  const fmt = rs.costFormat;
  const size = rosterSizeOf(rs);

  for (const m of roster) {
    const e = getTierEntry(m.name, fmt);
    const banned = isBanned(m.name, fmt);
    if (banned) {
      v.push({ code: 'banned', severity: 'warn', pokemon: m.name, message: `${m.name} is banned in this format` });
    } else if (!e) {
      v.push({ code: 'unknown_pokemon', severity: 'warn', pokemon: m.name, message: `${m.name} has no price in this format` });
    }
    used += monCost(m, rs);

    const base = getBaseFormName(m.name);
    const prev = seen.get(base);
    if (prev) v.push({ code: 'duplicate_species', severity: 'warn', pokemon: m.name, message: `${m.name} duplicates ${prev} (same National Dex number)` });
    else seen.set(base, m.name);

    if (isMegaForm(m.name)) megas.push(m.name);

    if (m.captain) {
      if (!rs.teraEnabled) {
        v.push({ code: 'tera_disabled', severity: 'warn', pokemon: m.name, message: `${m.name} is a captain but Tera is disabled in this ruleset` });
      } else if (e?.teraBanned) {
        v.push({ code: 'captain_tera_banned', severity: 'warn', pokemon: m.name, message: `${m.name} is tera-banned and cannot be a captain` });
      } else if (e && !captainEligible(rs, e)) {
        v.push({ code: 'captain_tier', severity: 'warn', pokemon: m.name, message: `${m.name} is tier ${e.tier}; that tier cannot be a captain in this ruleset` });
      }
      if (rs.teraEnabled) {
        if (m.teraTypes.length > rs.teraTypesPerCaptain) {
          v.push({ code: 'tera_types_over', severity: 'warn', pokemon: m.name, message: `${m.name} has more than ${rs.teraTypesPerCaptain} tera types` });
        } else if (m.teraTypes.length < rs.teraTypesPerCaptain) {
          v.push({ code: 'captain_no_tera', severity: 'info', pokemon: m.name, message: `${m.name} has ${m.teraTypes.length}/${rs.teraTypesPerCaptain} tera types picked` });
        }
      }
    }
  }

  const captains = roster.filter(m => m.captain).length;
  if (megas.length > megaLimit(rs)) {
    v.push({
      code: 'multi_mega', severity: 'warn',
      message: rs.megaCap === 0
        ? `${megas.length} Mega${megas.length === 1 ? '' : 's'} (${megas.join(', ')}); Megas are not allowed in this ruleset`
        : `${megas.length} Megas (${megas.join(', ')}); max ${rs.megaCap} per team`,
    });
  }
  if (rs.teraEnabled && captains > rs.teraCaptainSlots) {
    v.push({ code: 'captain_count', severity: 'warn', message: `${captains} captains; this ruleset allows ${rs.teraCaptainSlots}` });
  }
  if (roster.length > size) {
    v.push({ code: 'roster_over', severity: 'warn', message: `${roster.length} Pokemon; roster size is ${size}` });
  }
  const { min: rosterMin } = rosterBand(rs);
  if (roster.length > 0 && roster.length < rosterMin) {
    v.push({ code: 'roster_under', severity: 'info', message: `${roster.length}/${rosterMin} - ${rosterMin - roster.length} more to fill` });
  }
  if (used > rs.pointCap) {
    v.push({ code: 'over_budget', severity: 'warn', message: `${used} points used; budget is ${rs.pointCap}` });
  }

  return {
    used, budget: rs.pointCap, remaining: rs.pointCap - used,
    rosterSize: size, count: roster.length, violations: v,
  };
}

/** Warnings only (info-level nudges excluded) — what the badge counts. */
export const warnCount = (v: DcValidation): number => v.violations.filter(x => x.severity === 'warn').length;
