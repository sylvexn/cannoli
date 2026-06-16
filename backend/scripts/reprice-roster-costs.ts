/**
 * Re-price existing roster + draft-pick cost snapshots to each league's COST
 * FORMAT.
 *
 *   bun run scripts/reprice-roster-costs.ts --dry-run            # report only
 *   bun run scripts/reprice-roster-costs.ts                      # apply
 *   bun run scripts/reprice-roster-costs.ts --league=s11-emerald # one league
 *   CANNOLI_DB_PATH=/tmp/x.db bun run scripts/reprice-roster-costs.ts
 *
 * WHY: roster `cost_at_draft` is normally a frozen snapshot of the price paid
 * and is deliberately NOT recomputed. But Emerald drafted at the correct NatDex
 * numbers while the system was still snapshotting the global NatDex+ table — so
 * those snapshots are wrong (e.g. Mega Venusaur stored as 14, should be 16). This
 * one-off rewrites `rosters.tier` + `rosters.cost_at_draft` + `draft_picks.tier`
 * to the league's assigned cost format so point totals match how they drafted.
 *
 * TARGET (default): every NON-ARCHIVED league whose `cost_format != 'natdexplus'`
 * (i.e. Emerald). NatDex+ leagues drafted under the baseline and are already
 * correct, so they're skipped. Archived seasons are never touched — their
 * snapshots are historical truth. Override with `--league=<id>`.
 *
 * Requires `format_costs` to be populated first (run apply-cost-formats.ts).
 * Idempotent: re-running converges to zero changes. Flags two anomalies without
 * mutating them: picks now banned in the format, and teams now over the cap.
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { existsSync } from 'fs';

const DB_PATH = process.env.CANNOLI_DB_PATH || resolve(import.meta.dir, '../data/cannoli.db');
const DRY = process.argv.includes('--dry-run');
const leagueArg = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];

// Tera-captain markup (tiers ≤9 cost more as captains). Mirrors lib/tera-cost.ts.
const TERA_COST_MAP: Record<number, number> = { 9: 12, 8: 10, 7: 9, 6: 8, 5: 6, 4: 5, 3: 4, 2: 2, 1: 1 };
const effective = (tier: number, captain: boolean) => (captain ? TERA_COST_MAP[tier] ?? tier : tier);

if (!existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}.`);
  process.exit(1);
}

const db = new Database(DB_PATH);

// Target leagues: a specific id, or all non-archived non-natdexplus leagues.
const leagues = (
  leagueArg
    ? db.prepare(
        `SELECT l.id, l.name, l.cost_format AS costFormat, s.point_cap AS pointCap, s.archived
           FROM leagues l JOIN seasons s ON l.season_id = s.id WHERE l.id = ?`,
      ).all(leagueArg)
    : db.prepare(
        `SELECT l.id, l.name, l.cost_format AS costFormat, s.point_cap AS pointCap, s.archived
           FROM leagues l JOIN seasons s ON l.season_id = s.id
          WHERE s.archived = 0 AND l.cost_format != 'natdexplus'`,
      ).all()
) as { id: string; name: string; costFormat: string; pointCap: number; archived: number }[];

if (leagues.length === 0) {
  console.log('No target leagues (non-archived, cost_format != natdexplus). Nothing to do.');
  process.exit(0);
}

console.log(`\n=== Reprice roster costs → ${DB_PATH}${DRY ? ' (dry run)' : ''} ===`);

const fmtCostMap = (format: string) => {
  const rows = db.prepare('SELECT pokemon_name AS name, tier, banned FROM format_costs WHERE cost_format = ?').all(format) as
    { name: string; tier: number; banned: number }[];
  return new Map(rows.map((r) => [r.name, { tier: r.tier, banned: !!r.banned }]));
};

const updRoster = db.prepare('UPDATE rosters SET tier = ?, cost_at_draft = ? WHERE id = ?');
const updPick = db.prepare('UPDATE draft_picks SET tier = ? WHERE id = ?');

let totalRosterChanged = 0, totalPickChanged = 0;
const bannedFlags: string[] = [];
const overCapFlags: string[] = [];
const sampleChanges: string[] = [];

const run = db.transaction(() => {
  for (const lg of leagues) {
    const costs = fmtCostMap(lg.costFormat);
    if (costs.size === 0) {
      console.warn(`  ⚠  ${lg.id}: format_costs[${lg.costFormat}] is empty — run apply-cost-formats.ts first. Skipping.`);
      continue;
    }

    // Roster rows for this league's teams.
    const roster = db.prepare(
      `SELECT r.id, r.team_id AS teamId, r.pokemon_name AS name, r.tier, r.cost_at_draft AS costAtDraft,
              r.is_tera_captain AS isCaptain
         FROM rosters r JOIN teams t ON r.team_id = t.id WHERE t.league_id = ?`,
    ).all(lg.id) as { id: number; teamId: string; name: string; tier: number; costAtDraft: number; isCaptain: number }[];

    let rChanged = 0;
    for (const r of roster) {
      const c = costs.get(r.name);
      if (!c) { bannedFlags.push(`${lg.id}: ${r.name} — not in format ${lg.costFormat} (left unchanged)`); continue; }
      if (c.banned || c.tier === 99) {
        bannedFlags.push(`${lg.id}: ${r.name} is BANNED in ${lg.costFormat} (illegal pick — left unchanged)`);
        continue;
      }
      if (r.tier !== c.tier || r.costAtDraft !== c.tier) {
        if (sampleChanges.length < 25) sampleChanges.push(`${lg.id}: ${r.name} ${r.costAtDraft} → ${c.tier}`);
        if (!DRY) updRoster.run(c.tier, c.tier, r.id);
        rChanged++;
      }
    }

    // Draft picks for this league.
    const picks = db.prepare('SELECT id, pokemon_name AS name, tier FROM draft_picks WHERE league_id = ?').all(lg.id) as
      { id: number; name: string; tier: number }[];
    let pChanged = 0;
    for (const p of picks) {
      const c = costs.get(p.name);
      if (!c || c.banned || c.tier === 99) continue;
      if (p.tier !== c.tier) { if (!DRY) updPick.run(c.tier, p.id); pChanged++; }
    }

    // Per-team new effective total vs cap (uses the NEW prices + captain markup).
    const teams = db.prepare('SELECT id, team_name AS name FROM teams WHERE league_id = ?').all(lg.id) as { id: string; name: string }[];
    for (const tm of teams) {
      const total = roster
        .filter((r) => r.teamId === tm.id)
        .reduce((s, r) => s + effective(costs.get(r.name)?.tier ?? r.costAtDraft, !!r.isCaptain), 0);
      if (total > lg.pointCap) overCapFlags.push(`${lg.id}/${tm.name}: ${total} > cap ${lg.pointCap}`);
    }

    totalRosterChanged += rChanged;
    totalPickChanged += pChanged;
    console.log(`  ${lg.id.padEnd(14)} [${lg.costFormat}] rosters ${rChanged} repriced, draft_picks ${pChanged} repriced (${roster.length} mons)`);
  }
});

run();
if (!DRY) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

if (sampleChanges.length) {
  console.log(`\n  sample reprices${sampleChanges.length >= 25 ? ' (first 25)' : ''}:`);
  for (const s of sampleChanges) console.log(`    ${s}`);
}
if (bannedFlags.length) {
  console.log(`\n  ⚠  ${bannedFlags.length} flagged (banned/unknown in format — NOT changed):`);
  for (const f of bannedFlags) console.log(`    ${f}`);
}
if (overCapFlags.length) {
  console.log(`\n  ⚠  ${overCapFlags.length} team(s) over cap at the new prices:`);
  for (const f of overCapFlags) console.log(`    ${f}`);
} else {
  console.log(`\n  ✓ all teams within cap at the new prices`);
}

console.log(`\n=== ${DRY ? 'Would reprice' : 'Repriced'}: ${totalRosterChanged} roster rows, ${totalPickChanged} draft picks across ${leagues.length} league(s) ===`);
if (DRY) console.log('Dry run — no changes written.');
