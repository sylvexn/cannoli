/**
 * Bot end-to-end harness — drives the LIVE Showdown pipeline with no humans:
 *
 *   seed → boot backend (in-process bot logs into PS) → 2 scripted PS clients
 *   SSO-login + /utm → ready up in the Cannoli arena → backend /cannoli-battle
 *   creates the battle → battle reaches |win| → bot auto-writes match_result.
 *
 * Scenario 1 (forfeit): proves the whole live path + the SHO-2 winner-flag case.
 * Scenario 2 (real moves): both clients play to a natural KO finish so we can
 * assert match_pokemon kills/deaths are recorded.
 *
 * PREREQ: a PS server listening on :8000 (scripts/bot-e2e/run.sh starts one).
 *
 *   PS server up, then:  CANNOLI_DB_PATH=/tmp/bot-e2e.db bun run scripts/bot-e2e/run.ts
 */
import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { seedE2E, E2E } from './seed-e2e';

const ROOT = resolve(import.meta.dir, '../../..');
const BACKEND_DIR = resolve(import.meta.dir, '../..');
const DB_PATH = process.env.CANNOLI_DB_PATH || '/tmp/bot-e2e.db';
const BASE = 'http://localhost:3001';
const ARENA_WS = 'ws://localhost:3001/ws/arena';

// Make signAssertion (used by the in-process PS clients) work in THIS process.
process.env.PS_RSA_PRIVATE_KEY = readFileSync(resolve(ROOT, 'showdown/ps_private.pem'), 'utf8');
process.env.PS_HOSTNAME = 'localhost';
process.env.PS_KEY_ID = '4';
process.env.PS_SERVER_WS_URL ||= 'ws://localhost:8000/showdown/websocket';

const { PSClient } = await import('./ps-client');

// tiny utils
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let FAILS = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? '  PASS' : '  FAIL'} ${msg}`);
  if (!cond) FAILS++;
}
async function until<T>(fn: () => T | null | undefined, ms: number, every = 500): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(every); }
  return null;
}

// backend process + stdout line watching
type Matcher = { re: RegExp; resolve: () => void };
const matchers = new Set<Matcher>();
function onStdoutLine(line: string) {
  for (const m of matchers) if (m.re.test(line)) { m.resolve(); matchers.delete(m); }
}
function waitForLog(re: RegExp, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const m: Matcher = { re, resolve: () => resolve(true) };
    matchers.add(m);
    setTimeout(() => { matchers.delete(m); resolve(false); }, ms);
  });
}

function startBackend() {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      CANNOLI_DB_PATH: DB_PATH,
      CANNOLI_MODE: 'mock',
      PS_SERVER_WS_URL: process.env.PS_SERVER_WS_URL,
      PS_HOSTNAME: 'localhost',
      PS_KEY_ID: '4',
      BOT_USERNAME: 'CannoliBot',
      BOT_PASSWORD: 'cannolibot',
      PS_RSA_PRIVATE_KEY: process.env.PS_RSA_PRIVATE_KEY,
      PS_LOGS_DIR: resolve(ROOT, 'showdown/server/logs'),
      READY_TIMEOUT_MS: '60000',
      PORT: '3001',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk);
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        console.log(`    [be] ${line}`);
        onStdoutLine(line);
      }
    }
  })();
  (async () => { const dec = new TextDecoder(); for await (const c of proc.stderr) process.stderr.write(`    [be:err] ${dec.decode(c)}`); })();
  return proc;
}

// cannoli login → Cookie header
async function login(username: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: E2E.password }),
  });
  if (!res.ok) throw new Error(`login ${username} failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  return cookies.join('; ');
}

// arena WS client (ready-up)
function arenaReady(cookie: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ARENA_WS, { headers: { Cookie: cookie } } as any);
    const t = setTimeout(() => reject(new Error(`${label}: arena identify timeout`)), 15000);
    ws.addEventListener('message', (ev) => {
      let msg: any; try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === 'identified') {
        clearTimeout(t);
        console.log(`  [arena:${label}] identified team=${msg.teamId}; readying`);
        ws.send(JSON.stringify({ type: 'match_ready' }));
        resolve();
      }
    });
    ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error(`${label}: arena ws error ${e}`)); });
  });
}

// DB readers
function readMatch(id: string) {
  const db = new Database(DB_PATH, { readonly: true });
  try { return db.query('SELECT status, home_score h, away_score a, winner_team_id w, ps_room_id r FROM matches WHERE id = ?').get(id) as any; }
  finally { db.close(); }
}
function readMons(id: string) {
  const db = new Database(DB_PATH, { readonly: true });
  try { return db.query('SELECT team_id t, pokemon_name n, kills k, deaths d, tera_used tu FROM match_pokemon WHERE match_id = ?').all(id) as any[]; }
  finally { db.close(); }
}

// scenarios
async function runMatch(opts: {
  title: string; matchId: string; home: string; away: string; homeTeam: string; awayTeam: string;
  play: boolean; forfeitBy?: string;
}) {
  console.log(`\n=== ${opts.title} (${opts.matchId}) ===`);
  let winnerSeen: string | null = null;
  const ps: Record<string, InstanceType<typeof PSClient>> = {
    [opts.home]: new PSClient(opts.home, { play: opts.play, onWin: (w) => (winnerSeen = w) }),
    [opts.away]: new PSClient(opts.away, { play: opts.play, onWin: (w) => (winnerSeen = w) }),
  };
  // 1. PS login + team
  await Promise.all([ps[opts.home].connect(), ps[opts.away].connect()]);
  ps[opts.home].setTeam(); ps[opts.away].setTeam();
  await sleep(500);
  // 2. cannoli login + arena ready
  const [ch, ca] = await Promise.all([login(opts.home), login(opts.away)]);
  await arenaReady(ch, opts.home);
  await arenaReady(ca, opts.away);
  // 3. wait for the battle to be created (both clients pulled in)
  const created = await until(() => (ps[opts.home].battleRoom && ps[opts.away].battleRoom) || null, 30000);
  check(!!created, 'battle room created and both clients joined');
  if (!created) { Object.values(ps).forEach((c) => c.close()); return; }
  await sleep(1000);

  if (opts.forfeitBy) {
    ps[opts.forfeitBy].forfeit();
  }

  // 4. wait for the bot to auto-record the result. 'completed' is the happy
  //    path; 'disputed' also means the bot auto-wrote it (validation flagged a
  //    warning) — both retire manual entry, which is the milestone under test.
  const rec = (s?: string) => s === 'completed' || s === 'disputed';
  const done = await until(() => { const m = readMatch(opts.matchId); return rec(m?.status) ? m : null; }, 210000, 1000);
  check(!!done, `match auto-recorded, no manual entry (status=${done?.status ?? 'none'})`);
  if (done) {
    check(done.status === 'completed', `recorded clean as 'completed' (rosters validated)`);
    check(done.w === opts.homeTeam || done.w === opts.awayTeam, `winner_team_id set (${done.w})`);
    check(done.r != null, `ps_room_id stored (${done.r})`);
    check(done.h != null && done.a != null, `scores recorded (${done.h}-${done.a})`);
    check(winnerSeen != null, `client observed |win|${winnerSeen ? ' ' + winnerSeen : ''}`);
    if (opts.play) {
      const mons = readMons(opts.matchId);
      check(mons.length > 0, `match_pokemon rows written (${mons.length})`);
      const kills = mons.reduce((s, m) => s + m.k, 0);
      const deaths = mons.reduce((s, m) => s + m.d, 0);
      check(kills > 0, `total kills recorded (${kills})`);
      check(deaths > 0, `total deaths recorded (${deaths})`);
      const homeMons = mons.filter((m) => m.t === opts.homeTeam).length;
      const awayMons = mons.filter((m) => m.t === opts.awayTeam).length;
      check(homeMons > 0 && awayMons > 0, `both teams' mons attributed (home ${homeMons}, away ${awayMons})`);
      console.log('    stat sample:', mons.slice(0, 4).map((m) => `${m.n} ${m.k}K/${m.d}D${m.tu ? ' tera' : ''}`).join(', '));
    }
  }
  Object.values(ps).forEach((c) => c.close());
}

// main
console.log('[harness] seeding e2e world (fresh DB)');
for (const suf of ['', '-wal', '-shm']) { try { require('fs').rmSync(DB_PATH + suf); } catch {} }
seedE2E();

console.log('[harness] booting backend (in-process PS bot)');
const backend = startBackend();
// Always reap the backend child — even if `timeout`/Ctrl-C kills this harness,
// so we don't leave an orphan holding :3001 + the DB for the next run.
const reap = () => { try { backend.kill(); } catch {} };
process.on('SIGINT', () => { reap(); process.exit(130); });
process.on('SIGTERM', () => { reap(); process.exit(143); });
process.on('exit', reap);
// Register the bot-auth matcher BEFORE polling health — the bot authenticates
// during the health-poll window, so registering after would miss the line.
const botUpP = waitForLog(/Authenticated as \+?CannoliBot/i, 40000);
let healthy = false;
for (let end = Date.now() + 30000; Date.now() < end; await sleep(500)) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) { healthy = true; break; } } catch {}
}
check(healthy, 'backend healthy on :3001');
const botUp = await botUpP;
check(botUp, 'in-process bot logged into PS');

if (healthy && botUp) {
  await runMatch({
    title: 'Scenario 1 — forfeit', matchId: E2E.matchForfeit,
    home: E2E.coaches[0].username, away: E2E.coaches[1].username,
    homeTeam: E2E.coaches[0].teamId, awayTeam: E2E.coaches[1].teamId,
    play: false, forfeitBy: E2E.coaches[1].username,
  });
  await runMatch({
    title: 'Scenario 2 — real moves (stat logging)', matchId: E2E.matchStats,
    home: E2E.coaches[2].username, away: E2E.coaches[3].username,
    homeTeam: E2E.coaches[2].teamId, awayTeam: E2E.coaches[3].teamId,
    play: true,
  });
}

console.log(`\n${FAILS === 0 ? 'PASS — all checks green' : `FAIL — ${FAILS} check(s) failed`}`);
backend.kill();
await sleep(300);
process.exit(FAILS === 0 ? 0 : 1);
