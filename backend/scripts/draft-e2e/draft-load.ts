/**
 * Draft-load harness — 12 headless WS clients run a full snake draft with no
 * humans, validating the things a real 12-coach draft night would:
 *   - snake order correct for all 12 (round 1 forward, round 2 reversed)
 *   - picks submitted over /ws/draft/:leagueId advance the clock
 *   - idempotent picks: a duplicate clientRequestId does NOT double-draft
 *   - reconnect mid-draft rehydrates full state
 *   - server 1Hz timer expiry → draft pauses → admin auto-pick resumes it
 *   - draft completes; the post-draft CAPTAIN GATE blocks phase advance until
 *     every team locks captains, then the league flips draft → regular
 *
 *   CANNOLI_DB_PATH=/tmp/draft-e2e.db bun run scripts/draft-e2e/draft-load.ts
 */
import { resolve } from 'path';
import { seedDraft, DRAFT } from './seed-draft';
import fixture from '../../tests/fixtures/pokemon-reference.json';

const BACKEND_DIR = resolve(import.meta.dir, '../..');
const DB_PATH = process.env.CANNOLI_DB_PATH || '/tmp/draft-e2e.db';
const BASE = 'http://localhost:3001';
const DRAFT_WS = `ws://localhost:3001/ws/draft/${DRAFT.leagueId}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let FAILS = 0;
function check(cond: boolean, msg: string) { console.log(`${cond ? '  PASS' : '  FAIL'} ${msg}`); if (!cond) FAILS++; }

// captain eligibility lookup (tier ≤ 9, not tera-banned)
const monMeta = new Map((fixture as any[]).map((p) => [p.name, { tier: p.tier, teraBanned: !!p.tera_banned, banned: !!p.banned }]));
// cheap, captain-eligible, unique pool for manual picks
const POOL = (fixture as any[])
  .filter((p) => !p.banned && !p.tera_banned && p.tier >= 1 && p.tier <= 5 && p.form_category === 'base')
  .map((p) => p.name);
let poolIdx = 0;
const nextName = () => POOL[poolIdx++];

// ── backend ───────────────────────────────────────────────────────────────────
function startBackend() {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, CANNOLI_DB_PATH: DB_PATH, CANNOLI_MODE: 'mock', PORT: '3001' },
    stdout: 'pipe', stderr: 'pipe',
  });
  (async () => { const d = new TextDecoder(); for await (const c of proc.stdout) process.stdout.write(`    [be] ${d.decode(c)}`); })();
  (async () => { const d = new TextDecoder(); for await (const c of proc.stderr) process.stderr.write(`    [be:err] ${d.decode(c)}`); })();
  return proc;
}

// ── auth ────────────────────────────────────────────────────────────────────
async function login(username: string): Promise<{ cookie: string; csrf: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: DRAFT.password }),
  });
  if (!res.ok) throw new Error(`login ${username}: ${res.status} ${await res.text()}`);
  const setc = res.headers.getSetCookie();
  const cookie = setc.map((c) => c.split(';')[0]).join('; ');
  const csrf = (cookie.match(/csrf_token=([^;]+)/) || [])[1] ?? '';
  return { cookie, csrf };
}
function api(method: string, path: string, auth: { cookie: string; csrf: string }, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── draft WS client ───────────────────────────────────────────────────────────
class DraftClient {
  snapshot: any = null;
  picksObserved: { clientRequestId?: string; idempotent?: boolean }[] = [];
  private ws!: WebSocket;
  constructor(public teamId: string, public username: string, private cookie: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(DRAFT_WS, { headers: { Cookie: this.cookie } } as any);
      const t = setTimeout(() => reject(new Error(`${this.username}: draft WS open timeout`)), 10000);
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
      this.ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error(`${this.username}: ws err ${e}`)); });
      this.ws.addEventListener('message', (ev) => {
        let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.type === 'draft_state') this.snapshot = m.data;
        else if (m.type === 'pick_made' || m.type === 'auto_pick') {
          if (m.data?.snapshot) this.snapshot = m.data.snapshot;
          this.picksObserved.push({ clientRequestId: m.clientRequestId, idempotent: m.idempotent });
        }
      });
    });
  }
  identify() { this.ws.send(JSON.stringify({ type: 'identify', teamId: this.teamId, username: this.username, role: 'user' })); }
  pick(pokemonName: string, clientRequestId: string) {
    this.ws.send(JSON.stringify({ type: 'pick', pokemonName, teamId: this.teamId, username: this.username, clientRequestId }));
  }
  close() { try { this.ws.close(); } catch {} }
}

// ── main ────────────────────────────────────────────────────────────────────
console.log('[draft-harness] seeding (fresh DB)');
for (const suf of ['', '-wal', '-shm']) { try { require('fs').rmSync(DB_PATH + suf); } catch {} }
seedDraft();

console.log('[draft-harness] booting backend');
const backend = startBackend();
const reap = () => { try { backend.kill(); } catch {} };
process.on('SIGINT', () => { reap(); process.exit(130); });
process.on('SIGTERM', () => { reap(); process.exit(143); });
process.on('exit', reap);

let healthy = false;
for (let end = Date.now() + 30000; Date.now() < end; await sleep(500)) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) { healthy = true; break; } } catch {}
}
check(healthy, 'backend healthy on :3001');

if (healthy) {
  const admin = await login(DRAFT.admin);
  const auths = await Promise.all(DRAFT.teams.map((t) => login(t.username)));
  const clients = DRAFT.teams.map((t, i) => new DraftClient(t.teamId, t.username, auths[i].cookie));
  (globalThis as any).__clients = clients;
  await Promise.all(clients.map((c) => c.connect()));
  clients.forEach((c) => c.identify());
  await sleep(500);
  const byTeam = new Map(clients.map((c) => [c.teamId, c]));

  // Start the draft (admin REST).
  const startRes = await api('POST', `/api/leagues/${DRAFT.leagueId}/draft/start`, admin, { timerDuration: DRAFT.timerSeconds });
  if (!startRes.ok) console.log(`    start 403 body: ${await startRes.clone().text()}  csrf=${admin.csrf.slice(0, 8)}… cookie=${admin.cookie.slice(0, 40)}…`);
  check(startRes.ok, `draft started via REST (${startRes.status})`);
  const snap0 = await waitSnap((s) => s?.status === 'in_progress', 8000);
  check(!!snap0, 'draft is in_progress, snapshot broadcast to clients');

  // Snake order correctness.
  if (snap0) {
    const order = DRAFT.teams.map((t) => t.teamId);
    const r1 = snap0.snakeOrder.filter((p: any) => p.round === 1).map((p: any) => p.teamId);
    const r2 = snap0.snakeOrder.filter((p: any) => p.round === 2).map((p: any) => p.teamId);
    check(snap0.snakeOrder.length === 12 * DRAFT.rounds, `snake order has ${12 * DRAFT.rounds} slots`);
    check(JSON.stringify(r1) === JSON.stringify(order), 'round 1 follows draft order (forward)');
    check(JSON.stringify(r2) === JSON.stringify([...order].reverse()), 'round 2 is reversed (snake)');
  }

  // Drive the draft. One pick is left to TIMER EXPIRY → admin auto-pick; one is
  // sent TWICE to prove idempotency; one triggers a mid-draft RECONNECT.
  const TIMER_IDX = 6, IDEMP_IDX = 3, RECONNECT_IDX = 9;
  const issued = new Set<number>();
  let idempTeam = '', idempReqId = '', reconnectDone = false, timerObservedPause = false;

  for (let guard = 0; guard < 400; guard++) {
    const s = currentSnap();
    if (!s) { await sleep(150); continue; }
    if (s.status === 'completed') break;

    if (s.status === 'paused') {
      timerObservedPause = true;
      const ap = await api('POST', `/api/leagues/${DRAFT.leagueId}/draft/auto-pick`, admin);
      if (!ap.ok) console.log(`    auto-pick REST failed ${ap.status}`);
      await sleep(300);
      continue;
    }

    const idx = s.currentPickIndex;
    if (issued.has(idx)) { await sleep(150); continue; }
    const teamId = s.snakeOrder[idx].teamId;

    if (idx === RECONNECT_IDX && !reconnectDone) {
      // Reconnect a client NOT on the clock and assert it rehydrates.
      const victim = clients.find((c) => c.teamId !== teamId)!;
      victim.snapshot = null; victim.close(); await sleep(200);
      await victim.connect(); victim.identify();
      const re = await waitOn(victim, (sn) => sn?.currentPickIndex === idx, 5000);
      check(!!re, `reconnect mid-draft rehydrates state (pick #${idx})`);
      reconnectDone = true;
    }

    if (idx === TIMER_IDX) {
      // Do NOT pick — let the 1Hz server timer expire → pause branch handles it.
      if (!timerObservedPause) { await sleep(300); continue; }
      // already auto-picked + resumed; mark handled so we move on
      issued.add(idx); continue;
    }

    const name = nextName();
    const reqId = `pk-${idx}`;
    byTeam.get(teamId)!.pick(name, reqId);
    if (idx === IDEMP_IDX) { idempTeam = teamId; idempReqId = reqId; byTeam.get(teamId)!.pick(name, reqId); } // duplicate
    issued.add(idx);
    await sleep(250);
  }

  const final = currentSnap();
  check(final?.status === 'completed', `draft completed (${final?.picks?.length ?? 0} picks)`);
  check(final?.picks?.length === 12 * DRAFT.rounds, `exactly ${12 * DRAFT.rounds} picks — no double-draft from the idempotent retry`);
  check(timerObservedPause, 'server timer expiry paused the draft (then admin auto-pick resumed)');
  // idempotency: the duplicate produced an idempotent echo, not a 2nd pick
  const idempEchoes = clients.flatMap((c) => c.picksObserved).filter((p) => p.clientRequestId === idempReqId);
  check(idempEchoes.some((p) => p.idempotent === true), 'duplicate pick returned idempotent=true');

  // ── Captain gate ────────────────────────────────────────────────────────────
  const phaseBefore = await leaguePhase();
  check(phaseBefore === 'draft', `league still in 'draft' after draft completes (captain gate holds)`);

  if (final?.picks?.length) {
    const picksByTeam = new Map<string, string[]>();
    for (const p of final.picks) (picksByTeam.get(p.teamId) ?? picksByTeam.set(p.teamId, []).get(p.teamId)!).push(p.pokemonName);
    let lockOk = 0;
    for (const t of DRAFT.teams) {
      const eligible = (picksByTeam.get(t.teamId) ?? []).filter((n) => { const m = monMeta.get(n); return m && !m.teraBanned && m.tier <= 9; }).slice(0, 2);
      const res = await api('PUT', `/api/teams/${t.teamId}/tera-captains`, admin, {
        captains: eligible.map((pokemonName) => ({ pokemonName, teraTypes: ['Fire', 'Water', 'Grass'] })),
      });
      if (res.ok) lockOk++; else console.log(`    lock ${t.teamId} failed ${res.status}: ${await res.text()}`);
    }
    check(lockOk === 12, `all 12 teams locked captains (${lockOk}/12)`);
    const phaseAfter = await leaguePhase();
    check(phaseAfter === 'regular', `league advanced draft → '${phaseAfter}' once every team locked`);
  }
}

console.log(`\n${FAILS === 0 ? 'PASS — all checks green' : `FAIL — ${FAILS} check(s) failed`}`);
backend.kill();
await sleep(300);
process.exit(FAILS === 0 ? 0 : 1);

// ── helpers that close over clients ───────────────────────────────────────────
function currentSnap(): any { return (globalThis as any).__clients?.find((c: any) => c.snapshot)?.snapshot ?? null; }
async function waitSnap(pred: (s: any) => boolean, ms: number) {
  for (let end = Date.now() + ms; Date.now() < end; await sleep(150)) { const s = currentSnap(); if (s && pred(s)) return s; }
  return null;
}
async function waitOn(c: any, pred: (s: any) => boolean, ms: number) {
  for (let end = Date.now() + ms; Date.now() < end; await sleep(150)) { if (pred(c.snapshot)) return true; }
  return false;
}
function leaguePhase(): string {
  const { Database } = require('bun:sqlite');
  const db = new Database(DB_PATH, { readonly: true });
  try { return (db.query('SELECT phase FROM leagues WHERE id = ?').get(DRAFT.leagueId) as any)?.phase ?? '?'; }
  finally { db.close(); }
}
