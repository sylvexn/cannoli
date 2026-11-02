/**
 * Draft chaos run — a full 12-team snake draft with deliberate abuse:
 *   random WS disconnects/reconnects (incl. drop-right-after-send + retry), duplicate
 *   submits (same clientRequestId), illegal picks (must be rejected), and a couple of
 *   timer expiries (admin auto-pick resolves). Asserts the draft completes, every
 *   roster is legal, and no pick was double-applied.
 *
 *   bun run draft:chaos [seed]            (or CHAOS_SEED=…, CHAOS_PORT=…, CANNOLI_DB_PATH=…)
 */
import { rmSync } from 'fs';

const SEED = Number(process.argv[2] ?? process.env.CHAOS_SEED ?? Date.now() % 100000);
const DB_PATH = (process.env.CANNOLI_DB_PATH ||= '/tmp/draft-chaos.db'); // read by seed-draft at import
const PORT = Number(process.env.CHAOS_PORT) || 3031;
const BASE = `http://localhost:${PORT}`;

const { seedDraft, DRAFT } = await import('./seed-draft');
const { default: fixture } = await import('../../tests/fixtures/pokemon-reference.json');
const { sleep, makeChecker, startBackend, waitHealthy, login, api, DraftClient, auditRosters } = await import('./harness');
const { check, state } = makeChecker();

// mulberry32 — deterministic
let a = SEED >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const chance = (p: number) => rnd() < p;
const pickOne = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;

const usable = (fixture as any[]).filter((p) => !p.banned && p.tier >= 1);
const cheap = usable.filter((p) => p.tier <= 6 && p.form_category === 'base').map((p) => p.name).sort(() => rnd() - 0.5);
const megas = usable.filter((p) => p.form_category === 'mega' && p.tier <= 20).map((p) => p.name);
const isMega = new Set(megas);
const BANNED_OR_BOGUS = ['Definitely Not A Pokemon', ...(fixture as any[]).filter((p) => p.banned).slice(0, 3).map((p) => p.name)];

console.log(`[chaos] seed=${SEED} db=${DB_PATH} port=${PORT}`);
for (const suf of ['', '-wal', '-shm']) { try { rmSync(DB_PATH + suf); } catch {} }
seedDraft();
const backend = startBackend(DB_PATH, PORT, true);
check(await waitHealthy(BASE), 'backend healthy');

const WS = `ws://localhost:${PORT}/ws/draft/${DRAFT.leagueId}`;
const adminAuth = await login(BASE, DRAFT.admin, DRAFT.password);
const spectator = new DraftClient(WS, null, DRAFT.admin, adminAuth.cookie);
const clients = new Map<string, InstanceType<typeof DraftClient>>();
for (const t of DRAFT.teams) {
  const c = new DraftClient(WS, t.teamId, t.username, (await login(BASE, t.username, DRAFT.password)).cookie);
  clients.set(t.teamId, c);
}
await spectator.connect(); spectator.identify();
for (const c of clients.values()) { await c.connect(); c.identify(); }
const reconnect = async (teamId: string) => {
  const old = clients.get(teamId)!;
  old.close(); await sleep(60 + Math.floor(rnd() * 100));
  const c = new DraftClient(WS, teamId, old.username, (old as any).cookie);
  // carry error/observation history so checks see the whole run
  c.errors = old.errors; c.picksObserved = old.picksObserved;
  await c.connect(); c.identify(); clients.set(teamId, c);
};

const start = await api(BASE, 'POST', `/api/leagues/${DRAFT.leagueId}/draft/start`, adminAuth, { timerDuration: DRAFT.timerSeconds });
check(start.ok, `draft started (${start.status})`);
await sleep(300);

const stats = { disconnects: 0, retries: 0, dupSubmits: 0, illegalTried: 0, illegalRejected: 0, expiries: 0, picks: 0 };
const expectedReqIds = new Set<string>();
const teamMega = new Map<string, boolean>();
const used = new Set<string>();
const snap = () => spectator.snapshot;
const nextCheap = () => { let n: string | undefined; while ((n = cheap.shift()) && used.has(n)); return n!; };
const waitIndex = async (idx: number, ms = 4000) => { for (let e = Date.now() + ms; Date.now() < e; await sleep(40)) if ((snap()?.currentPickIndex ?? 0) > idx || snap()?.status === 'completed') return true; return false; };
const waitErr = async (c: InstanceType<typeof DraftClient>, reqId: string, ms = 2500) => { for (let e = Date.now() + ms; Date.now() < e; await sleep(40)) if (c.errors.some((x) => x.clientRequestId === reqId)) return true; return false; };

let expiriesLeft = 2;
for (let guard = 0; guard < 600 && snap()?.status !== 'completed'; guard++) {
  const s = snap();
  if (!s || s.status === 'not_started') { await sleep(100); continue; }
  if (s.status === 'paused') {
    stats.expiries++;
    const r = await api(BASE, 'POST', `/api/leagues/${DRAFT.leagueId}/draft/auto-pick`, adminAuth);
    if (!r.ok) check(false, `auto-pick after expiry failed (${r.status})`);
    await sleep(150); continue;
  }
  const idx = s.currentPickIndex as number;
  const teamId = s.snakeOrder[idx].teamId as string;
  if (idx >= 3 && expiriesLeft > 0 && chance(0.1)) { // let the 1Hz timer run out
    expiriesLeft--;
    for (let e = Date.now() + 15000; Date.now() < e && snap()?.status === 'in_progress'; await sleep(200));
    continue;
  }

  // illegal attempts: must be rejected, must not move the clock
  if (chance(0.3)) {
    const kind = pickOne(['bogus', 'drafted', 'off_turn', 'second_mega'] as const);
    const other = pickOne([...clients.keys()].filter((t) => t !== teamId));
    let who = teamId, name = pickOne(BANNED_OR_BOGUS);
    if (kind === 'drafted' && used.size) name = pickOne([...used]);
    if (kind === 'off_turn') { who = other; name = cheap[0]!; }
    if (kind === 'second_mega' && teamMega.get(teamId)) name = pickOne(megas);
    else if (kind === 'second_mega') name = pickOne(BANNED_OR_BOGUS);
    const reqId = `bad-${guard}`;
    stats.illegalTried++;
    clients.get(who)!.pick(name, reqId);
    const rejected = await waitErr(clients.get(who)!, reqId);
    if (rejected) stats.illegalRejected++;
    check(rejected && snap().currentPickIndex === idx, `illegal ${kind} pick rejected without advancing (#${idx})`);
  }

  if (chance(0.15)) { stats.disconnects++; await reconnect(teamId); } // on-clock coach drops before picking

  const wantMega = !teamMega.get(teamId) && chance(0.2);
  const name = wantMega ? pickOne(megas.filter((m) => !used.has(m))) : nextCheap();
  const reqId = `pk-${idx}`;
  expectedReqIds.add(reqId);
  let c = clients.get(teamId)!;
  c.pick(name, reqId);
  if (chance(0.3)) { stats.dupSubmits++; c.pick(name, reqId); }
  if (chance(0.15)) { // drop right after send, reconnect, retry the same request
    stats.disconnects++; stats.retries++;
    await reconnect(teamId); c = clients.get(teamId)!; c.pick(name, reqId);
  }
  if (!(await waitIndex(idx))) { check(false, `pick #${idx} (${name}) never applied`); break; }
  used.add(name); stats.picks++;
  if (isMega.has(name)) teamMega.set(teamId, true);
}

check(snap()?.status === 'completed', `draft completed (${snap()?.picks?.length ?? 0}/${DRAFT.teams.length * DRAFT.rounds} picks)`);
await sleep(300);

const audit = auditRosters(DB_PATH, DRAFT.leagueId, { pointCap: 110, rosterSize: DRAFT.rounds, megaCap: 1 });
check(audit.problems.length === 0, `rosters legal, no double-applied picks (${audit.picks} picks, ${audit.teams} teams)${audit.problems.length ? ': ' + audit.problems.join('; ') : ''}`);
const seen = spectator.picksObserved.filter((p) => p.clientRequestId && !p.idempotent).map((p) => p.clientRequestId!);
check(new Set(seen).size === seen.length, 'no clientRequestId broadcast as a real pick twice');
check(seen.every((r) => expectedReqIds.has(r)), 'every broadcast pick traces to a submitted request');
check(audit.picks === DRAFT.teams.length * DRAFT.rounds, 'pick count exact (no duplicates, none lost)');
check(stats.illegalRejected === stats.illegalTried, `all illegal picks rejected (${stats.illegalRejected}/${stats.illegalTried})`);

console.log(`[chaos] ${JSON.stringify(stats)} seed=${SEED}`);
console.log(state.fails === 0 ? 'PASS' : `FAIL — ${state.fails} check(s) failed (rerun: bun run draft:chaos ${SEED})`);
backend.kill(); await sleep(200);
process.exit(state.fails === 0 ? 0 : 1);
