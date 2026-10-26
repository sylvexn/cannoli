/**
 * Backfill rulesets from real league data (plan/ruleset-design.md section 4).
 *
 *   bun run scripts/backfill-rulesets.ts                       # DRY RUN on data/cannoli.db
 *   CANNOLI_DB_PATH=/tmp/x.db bun run scripts/backfill-rulesets.ts
 *   bun run scripts/backfill-rulesets.ts --apply               # write
 *
 * Needs migration 0076 for --apply (the dry run only reads leagues/seasons/
 * draft_templates, so it works on a pre-migration DB). Idempotent: only leagues
 * with ruleset_id NULL are processed; templates are matched by name. Never
 * touches prices (`format_costs`) or the legacy season/league columns, so
 * archived history keeps validating exactly as before.
 */

import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { DEFAULT_MARKUP } from '@cannoli/rules';

const FORMAT_LABEL: Record<string, string> = { natdex: 'NatDex (Emerald)', natdexplus: 'NatDex+' };
const MARKUP = JSON.stringify(DEFAULT_MARKUP);

interface LeagueRow {
  id: string; season_number: number; cost_format: string; point_cap: number;
  roster_size: number; min_roster_size: number | null; max_roster_size: number | null;
  tera_slots: number; phase: string; ruleset_id: number | null;
}
interface Group {
  key: string; row: LeagueRow; leagues: string[]; seasons: number[];
}

export interface BackfillReport {
  instances: { name: string; leagues: string[]; costFormat: string; pointCap: number; rosterSize: number; band: [number | null, number | null]; slots: number }[];
  templates: string[];
  draftCenterTeams: number;
  formatCostCounts: Record<string, number>;
  warnings: string[];
}

const has = (db: Database, table: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);

const label = (f: string) => FORMAT_LABEL[f] ?? f;
const seasonSpan = (s: number[]) => {
  const lo = Math.min(...s), hi = Math.max(...s);
  return lo === hi ? `S${lo}` : `S${lo}–S${hi}`;
};

export function backfillRulesets(db: Database, apply: boolean): BackfillReport {
  const rep: BackfillReport = { instances: [], templates: [], draftCenterTeams: 0, formatCostCounts: {}, warnings: [] };
  const canWrite = apply && has(db, 'rulesets');
  if (apply && !canWrite) throw new Error('rulesets table missing - run migrations (0076) first');
  const hasCol = has(db, 'rulesets') &&
    (db.prepare("PRAGMA table_info(leagues)").all() as any[]).some(c => c.name === 'ruleset_id');

  const leagues = db.prepare(`
    SELECT l.id, s.season_number, l.cost_format, s.point_cap, l.roster_size,
           l.min_roster_size, l.max_roster_size, s.tera_captain_slots AS tera_slots, l.phase,
           ${hasCol ? 'l.ruleset_id' : 'NULL'} AS ruleset_id
    FROM leagues l JOIN seasons s ON s.id = l.season_id
    ORDER BY s.season_number, l.id`).all() as LeagueRow[];

  // Cost-format sanity check (design Q13): leagues must be priced on a populated format.
  if (has(db, 'format_costs')) {
    for (const r of db.prepare('SELECT cost_format f, COUNT(*) n FROM format_costs GROUP BY cost_format').all() as any[]) {
      rep.formatCostCounts[r.f] = r.n;
    }
  }
  for (const f of new Set(leagues.map(l => l.cost_format))) {
    if (!rep.formatCostCounts[f]) rep.warnings.push(`format_costs has 0 rows for '${f}' - verify the DB is priced before relying on rulesets`);
  }

  // 1. instances by distinct effective tuple
  const groups = new Map<string, Group>();
  for (const l of leagues.filter(l => l.ruleset_id == null)) {
    const key = [l.cost_format, l.point_cap, l.roster_size, l.min_roster_size, l.max_roster_size, l.tera_slots].join('|');
    const g = groups.get(key) ?? { key, row: l, leagues: [], seasons: [] };
    g.leagues.push(l.id);
    g.seasons.push(l.season_number);
    groups.set(key, g);
  }

  const insert = canWrite ? db.prepare(`
    INSERT INTO rulesets (name, description, is_template, source_ruleset_id, cost_format, point_cap,
      roster_size, roster_min, roster_max, mega_cap, tera_enabled, tera_captain_slots,
      tera_types_per_captain, tera_markup)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 3, ?)`) : null;
  const mk = (name: string, desc: string, tpl: boolean, src: number | null, r: { cost_format: string; point_cap: number; roster_size: number; min: number | null; max: number | null; slots: number }) =>
    Number(insert!.run(name, desc, tpl ? 1 : 0, src, r.cost_format, r.point_cap, r.roster_size, r.min, r.max, r.slots, MARKUP).lastInsertRowid);

  const run = () => {
    let s11: { id: number; row: LeagueRow }[] = [];
    for (const g of groups.values()) {
      const r = g.row;
      const name = `${label(r.cost_format)} · ${r.point_cap}pt · ${seasonSpan(g.seasons)}`;
      rep.instances.push({
        name, leagues: g.leagues, costFormat: r.cost_format, pointCap: r.point_cap, rosterSize: r.roster_size,
        band: [r.min_roster_size, r.max_roster_size], slots: r.tera_slots,
      });
      if (!canWrite) continue;
      const id = mk(name, 'Backfilled from league data (frozen history).', false, null,
        { ...r, min: r.min_roster_size, max: r.max_roster_size, slots: r.tera_slots });
      for (const lid of g.leagues) db.prepare('UPDATE leagues SET ruleset_id = ? WHERE id = ?').run(id, lid);
      s11.push({ id, row: r });
    }

    // 2. templates (matched by name so re-runs are no-ops)
    const tplExists = (n: string) => !!db.prepare('SELECT 1 FROM rulesets WHERE name = ? AND is_template = 1').get(n);
    const addTpl = (name: string, desc: string, src: number | null, r: Parameters<typeof mk>[4]) => {
      if (canWrite && tplExists(name)) return;
      rep.templates.push(name);
      if (canWrite) mk(name, desc, true, src, r);
    };
    addTpl('Default — NatDex+', 'Standard rules; fallback for Draft Center teams without a ruleset.', null,
      { cost_format: 'natdexplus', point_cap: 110, roster_size: 10, min: null, max: null, slots: 2 });
    // "S11 base" templates: the latest season's distinct rule tuples.
    const latest = Math.max(0, ...leagues.map(l => l.season_number));
    const seen = new Set<string>();
    for (const l of leagues.filter(l => l.season_number === latest)) {
      if (seen.has(l.cost_format)) continue;
      seen.add(l.cost_format);
      const inst = s11.find(x => x.row.cost_format === l.cost_format && x.row.season_number === latest);
      addTpl(`${label(l.cost_format)} — S${latest} base`, `Copied from the S${latest} ${label(l.cost_format)} rules.`, inst?.id ?? null,
        { cost_format: l.cost_format, point_cap: l.point_cap, roster_size: l.roster_size, min: l.min_roster_size, max: l.max_roster_size, slots: l.tera_slots });
    }
    if (has(db, 'draft_templates')) {
      for (const t of db.prepare('SELECT name, point_cap, roster_size, captain_count FROM draft_templates').all() as any[]) {
        addTpl(`${t.name} (legacy template)`, 'Migrated from draft_templates.', null,
          { cost_format: 'natdexplus', point_cap: t.point_cap, roster_size: t.roster_size, min: null, max: null, slots: t.captain_count });
      }
    }

    // 3. Draft Center teams: league's ruleset, else Default
    if (has(db, 'draft_center_teams') && hasCol) {
      const n = (db.prepare('SELECT COUNT(*) n FROM draft_center_teams WHERE ruleset_id IS NULL').get() as any).n;
      rep.draftCenterTeams = n;
      if (canWrite && n) {
        db.prepare(`UPDATE draft_center_teams SET ruleset_id = (SELECT ruleset_id FROM leagues WHERE leagues.id = draft_center_teams.league_id)
                    WHERE ruleset_id IS NULL AND league_id IS NOT NULL`).run();
        db.prepare(`UPDATE draft_center_teams SET ruleset_id = (SELECT id FROM rulesets WHERE name = 'Default — NatDex+' AND is_template = 1 LIMIT 1)
                    WHERE ruleset_id IS NULL`).run();
      }
    }
  };

  if (canWrite) db.transaction(run)(); else run();
  return rep;
}

if (import.meta.main) {
  const apply = process.argv.includes('--apply');
  const path = process.env.CANNOLI_DB_PATH ? resolve(process.env.CANNOLI_DB_PATH) : resolve(import.meta.dir, '../data/cannoli.db');
  const db = new Database(path, apply ? undefined : { readonly: true });
  console.log(`[backfill-rulesets] ${apply ? 'APPLY' : 'DRY RUN'} on ${path}`);
  const rep = backfillRulesets(db, apply);
  console.log(JSON.stringify(rep, null, 2));
  if (!apply) console.log('(dry run - pass --apply to write)');
}
