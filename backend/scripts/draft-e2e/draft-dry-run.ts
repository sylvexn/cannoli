/**
 * Draft dry run — rehearse a league's REAL draft config on a throwaway copy of the DB.
 *
 *   bun run draft:dry-run <leagueId> [--db <path>]      (default DB: $CANNOLI_DB_PATH)
 *
 * The source DB is only ever opened read-only (VACUUM INTO). On the copy the league's draft
 * is reset (the engine's own force-restart wipes picks/rosters/captain flags), a backend is
 * spawned on a temp port, staff `root`/`admin` starts the draft and drives every pick through
 * the auto-pick endpoint (draft timer = 1s, backdated so each tick expires it) while a WS
 * spectator verifies every broadcast. Finally rosters are audited. Exit 1 on any failure.
 */
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { hashSync } from 'bcryptjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { sleep, makeChecker, startBackend, waitHealthy, login, api, DraftClient, auditRosters } from './harness';

const args = process.argv.slice(2);
const dbFlag = args.indexOf('--db');
const srcDb = dbFlag >= 0 ? args[dbFlag + 1] : process.env.CANNOLI_DB_PATH;
const leagueId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--db');
if (!leagueId || !srcDb) { console.error('usage: draft-dry-run.ts <leagueId> [--db <path>]'); process.exit(2); }

const { check, state } = makeChecker();
const dir = mkdtempSync(join(tmpdir(), 'cannoli-dryrun-'));
const copy = join(dir, 'dryrun.sqlite');
const t0 = Date.now();
let backend: ReturnType<typeof startBackend> | null = null;
const finish = (code: number): never => { try { backend?.kill(); } catch {} rmSync(dir, { recursive: true, force: true }); process.exit(code); };

// 1. copy (source opened read-only)
{
  const src = new Database(resolve(srcDb), { readonly: true });
  src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  src.close();
}
console.log(`[dry-run] ${leagueId}: copied ${srcDb} -> ${copy}`);

// 2. prep the copy
const sqlite = new Database(copy);
sqlite.exec('PRAGMA busy_timeout = 15000');
migrate(drizzle(sqlite), { migrationsFolder: resolve(import.meta.dir, '../../drizzle') });
const league = sqlite.query('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
if (!league) { console.error(`league "${leagueId}" not found`); finish(2); }
const teamIds = (sqlite.query('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as any[]).map((r) => r.id as string);
check(teamIds.length >= 2, `league has ${teamIds.length} teams`);
if (teamIds.length < 2) finish(1);

const notes: string[] = [];
let order: string[] = [];
try { order = JSON.parse(league.draft_order ?? '[]'); } catch {}
const isPerm = order.length === teamIds.length && new Set(order).size === order.length && order.every((t) => teamIds.includes(t));
if (!isPerm) { order = [...teamIds].sort(() => Math.random() - 0.5); notes.push('draft order was missing/invalid -> shuffled on the copy'); }
if (league.phase !== 'draft') notes.push(`phase ${league.phase} -> draft on the copy`);
sqlite.query(`UPDATE leagues SET phase = 'draft', draft_order = ?, current_week = 0 WHERE id = ?`).run(JSON.stringify(order), leagueId);
// The engine's restart only wipes draft-acquired roster rows; a league past its draft also has
// trade/FA rows that would collide with fresh picks, so clear the copy's rosters entirely.
sqlite.query('DELETE FROM rosters WHERE team_id IN (SELECT id FROM teams WHERE league_id = ?)').run(leagueId);
sqlite.query('UPDATE seasons SET archived = 0 WHERE id = ?').run(league.season_id); // archive guard would block staff
const pw = hashSync('admin', 4);
if (sqlite.query(`SELECT id FROM users WHERE username = 'root'`).get()) {
  sqlite.query(`UPDATE users SET password_hash = ?, role = 'bot', active = 1, must_change_password = 0 WHERE username = 'root'`).run(pw);
} else {
  sqlite.query(`INSERT INTO users (username, password_hash, role, active, must_change_password) VALUES ('root', ?, 'bot', 1, 0)`).run(pw);
  notes.push('created staff service account root on the copy');
}

// 3. backend on the copy
const port = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${port}`;
backend = startBackend(copy, port, true);
check(await waitHealthy(BASE), `backend on copy healthy (:${port})`);

const auth = await login(BASE, 'root', 'admin');
const spec = new DraftClient(`ws://localhost:${port}/ws/draft/${leagueId}`, null, 'root', auth.cookie);
await spec.connect(); spec.identify();

const rules = await (async () => {
  const rows = await (await api(BASE, 'GET', '/api/leagues', auth)).json() as any[];
  return rows.find((l) => l.id === leagueId)?.ruleset as { pointCap: number; rosterSize: number; megaCap: number | null };
})();
check(!!rules, `ruleset resolved (cap ${rules?.pointCap}, roster ${rules?.rosterSize}, mega ${rules?.megaCap})`);
if (!rules) finish(1);

// 4. start (force = the real restart path: wipes picks/rosters/captain flags) and drive
const start = await api(BASE, 'POST', `/api/leagues/${leagueId}/draft/start`, auth, { timerDuration: 1, force: true });
check(start.ok, `draft started (${start.status})${start.ok ? '' : ' ' + (await start.text())}`);
if (!start.ok) finish(1);

const total = teamIds.length * rules.rosterSize;
const rejections: string[] = [];
let bad = 0;
const waitFor = async (pred: () => boolean, ms: number) => { for (let e = Date.now() + ms; Date.now() < e; await sleep(50)) if (pred()) return true; return false; };

for (let i = 0; i < total; i++) {
  const before = spec.picksObserved.length;
  // Backdate the clock on the copy so the server's 1Hz tick expires this pick right away.
  sqlite.query(`UPDATE draft_state SET timer_started_at = ? WHERE league_id = ? AND status = 'in_progress'`)
    .run(new Date(Date.now() - 10_000).toISOString(), leagueId);
  if (!(await waitFor(() => spec.snapshot?.status === 'paused', 6000))) { rejections.push(`pick ${i + 1}: timer never expired`); bad++; break; }
  const onClock = spec.snapshot.snakeOrder[spec.snapshot.currentPickIndex]?.teamId;
  const res = await api(BASE, 'POST', `/api/leagues/${leagueId}/draft/auto-pick`, auth);
  if (!res.ok) { rejections.push(`pick ${i + 1}: auto-pick ${res.status} ${await res.text()}`); bad++; break; }
  const body = await res.json() as any;
  if (body?.success === false) { rejections.push(`pick ${i + 1}: engine refused auto-pick (${body.code ?? ''} ${body.error ?? ''}) for ${onClock}`); bad++; break; }
  if (!(await waitFor(() => spec.picksObserved.length > before, 4000))) { rejections.push(`pick ${i + 1}: no broadcast`); bad++; break; }
  const ev = spec.picksObserved.at(-1)!;
  const snap = spec.snapshot;
  if (ev.pickNumber !== i + 1 || snap?.picks?.length !== i + 1 || snap.picks.at(-1)?.teamId !== onClock) {
    rejections.push(`pick ${i + 1}: broadcast mismatch (pickNumber ${ev.pickNumber}, snapshot ${snap?.picks?.length} picks, team ${snap?.picks?.at(-1)?.teamId} vs on-clock ${onClock})`);
    bad++;
  }
  if ((i + 1) % 20 === 0) console.log(`  ... ${i + 1}/${total}`);
}
await waitFor(() => spec.snapshot?.status === 'completed', 4000);
check(spec.snapshot?.status === 'completed', 'draft reached completed');
check(bad === 0, `every pick broadcast matched the snake order${bad ? ` (${bad} bad)` : ''}`);

// 5. audit
await sleep(300);
const audit = auditRosters(copy, leagueId, rules);
check(audit.picks === total, `${audit.picks}/${total} picks recorded`);
check(audit.problems.length === 0, `final rosters legal${audit.problems.length ? ': ' + audit.problems.slice(0, 5).join('; ') : ''}`);

console.log(`\n[dry-run] ${leagueId}: ${audit.picks} picks, ${teamIds.length} teams, ${((Date.now() - t0) / 1000).toFixed(1)}s, ${rejections.length} rejections`);
for (const n of notes) console.log(`  note: ${n}`);
for (const r of rejections) console.log(`  rejection: ${r}`);
console.log(state.fails === 0 ? 'PASS' : `FAIL — ${state.fails} check(s) failed`);
sqlite.close();
finish(state.fails === 0 ? 0 : 1);
