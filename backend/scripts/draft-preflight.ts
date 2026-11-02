/**
 * Draft preflight — READ-ONLY go/no-go checklist before a league's draft.
 *
 *   bun run draft:preflight <leagueId> [--db <path>]      (default DB: $CANNOLI_DB_PATH)
 *
 * Prints PASS/WARN/FAIL lines; exit code 1 if any FAIL. The DB is opened read-only and
 * nothing outside it is touched (no app boot, no migrations).
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const args = process.argv.slice(2);
const dbFlag = args.indexOf('--db');
const dbPath = dbFlag >= 0 ? args[dbFlag + 1] : process.env.CANNOLI_DB_PATH;
const leagueId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--db');
if (!leagueId || !dbPath) { console.error('usage: draft-preflight.ts <leagueId> [--db <path>]'); process.exit(2); }

let fails = 0;
const out = (lvl: 'PASS' | 'WARN' | 'FAIL', msg: string) => { console.log(`${lvl} ${msg}`); if (lvl === 'FAIL') fails++; };
const db = new Database(resolve(dbPath), { readonly: true });
const q = <T = any>(sql: string, ...p: any[]) => db.query(sql).all(...p) as T[];
const one = <T = any>(sql: string, ...p: any[]) => db.query(sql).get(...p) as T | null;
const hasCol = (t: string, c: string) => q(`PRAGMA table_info(${t})`).some((r: any) => r.name === c);

const league = one('SELECT * FROM leagues WHERE id = ?', leagueId);
if (!league) { out('FAIL', `league "${leagueId}" not found`); process.exit(1); }
out('PASS', `league exists: ${league.name} (${leagueId})`);

// phase
if (league.phase === 'predraft' || league.phase === 'draft') out('PASS', `phase is ${league.phase}`);
else out('FAIL', `phase is ${league.phase} (expected predraft or draft)`);

// teams + order
const teams = q('SELECT id, user_id, team_name FROM teams WHERE league_id = ?', leagueId);
if (teams.length >= 2) out('PASS', `${teams.length} teams registered`); else out('FAIL', `only ${teams.length} team(s) registered`);
let order: string[] | null = null;
try { order = league.draft_order ? JSON.parse(league.draft_order) : null; } catch { order = null; }
if (!order) out('FAIL', 'draft order not set');
else {
  const ids = new Set(teams.map((t: any) => t.id));
  const perm = order.length === ids.size && new Set(order).size === order.length && order.every((t) => ids.has(t));
  if (perm) out('PASS', `draft order is an exact permutation of the ${ids.size} teams`);
  else out('FAIL', `draft order (${order.length}) is not an exact permutation of the league's ${ids.size} teams`);
}
if (hasCol('leagues', 'draft_order_locked')) {
  if (league.draft_order_locked) out('PASS', 'draft order locked');
  else out(order ? 'FAIL' : 'WARN', 'draft order not locked');
} else out('WARN', 'DB predates draft_order_locked migration (0079) - cannot check lock');

// coaches linked
const noUser = teams.filter((t: any) => t.user_id == null);
const users = new Set(q('SELECT id FROM users').map((u: any) => u.id));
const dangling = teams.filter((t: any) => t.user_id != null && !users.has(t.user_id));
if (!noUser.length && !dangling.length) out('PASS', 'every team has a linked, existing user');
else {
  if (noUser.length) out('FAIL', `teams with no userId: ${noUser.map((t: any) => t.team_name || t.id).join(', ')}`);
  if (dangling.length) out('FAIL', `teams whose userId has no user row: ${dangling.map((t: any) => t.team_name || t.id).join(', ')}`);
}

// existing picks / state
const pickCount = (one('SELECT COUNT(*) c FROM draft_picks WHERE league_id = ?', leagueId) as any).c as number;
if (pickCount === 0) out('PASS', 'no picks yet'); else out('WARN', `${pickCount} picks already exist (starting will need force and wipes them)`);
const ds = one('SELECT * FROM draft_state WHERE league_id = ?', leagueId);
if (ds && ds.status !== 'not_started') out('WARN', `draft_state already exists (status ${ds.status}, pick index ${ds.current_pick_index})`);

// ruleset / costs
const rs = league.ruleset_id != null ? one('SELECT * FROM rulesets WHERE id = ?', league.ruleset_id) : null;
const season = one('SELECT * FROM seasons WHERE id = ?', league.season_id);
const pointCap: number = rs?.point_cap ?? season?.point_cap ?? 110;
const rounds: number = rs?.roster_size ?? league.roster_size ?? 10;
const costFormat: string = rs?.cost_format ?? league.cost_format ?? 'natdexplus';
const costs = new Map<string, { tier: number; banned: boolean }>();
for (const p of q('SELECT name, tier, banned FROM pokemon')) costs.set(p.name, { tier: p.tier, banned: !!p.banned });
for (const f of q('SELECT pokemon_name n, tier, banned FROM format_costs WHERE cost_format = ?', costFormat)) costs.set(f.n, { tier: f.tier, banned: !!f.banned });
const pool = [...costs.values()].filter((c) => !c.banned && c.tier >= 1);
if (pool.length === 0) out('FAIL', `cost map for format "${costFormat}" is empty`);
else {
  const needed = teams.length * rounds;
  if (pool.length >= needed) out('PASS', `cost format "${costFormat}": ${pool.length} draftable mons for ${needed} picks`);
  else out('FAIL', `cost format "${costFormat}": only ${pool.length} draftable mons for ${needed} picks`);
  const cheapest = Math.min(...pool.map((c) => c.tier));
  if (rounds * cheapest <= pointCap) out('PASS', `feasible: ${rounds} rounds x cheapest ${cheapest}pt = ${rounds * cheapest} <= cap ${pointCap}`);
  else out('FAIL', `infeasible: ${rounds} rounds x cheapest ${cheapest}pt = ${rounds * cheapest} > cap ${pointCap}`);
}

// timer
const timer = ds?.timer_duration;
if (timer == null) out('WARN', 'no draft_state yet - timer defaults to 120s when the draft starts');
else if (timer >= 10 && timer <= 900) out('PASS', `timer ${timer}s`);
else out('WARN', `timer ${timer}s looks unusual (expected 10-900)`);
if (!Number.isInteger(rounds) || rounds < 1) out('FAIL', `roster size ${rounds} invalid`);

// draft date
if (!league.draft_date) out('WARN', 'draftDate not set');
else {
  const ts = Date.parse(league.draft_date);
  if (Number.isNaN(ts)) out('WARN', `draftDate "${league.draft_date}" is not a valid date`);
  else if (ts > Date.now()) out('PASS', `draftDate ${league.draft_date} is in the future`);
  else out('WARN', `draftDate ${league.draft_date} is in the past`);
}

db.close();
console.log(fails ? `\nFAIL - ${fails} blocking issue(s)` : '\nOK - no blocking issues');
process.exit(fails ? 1 : 0);
