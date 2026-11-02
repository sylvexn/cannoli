/**
 * Shared helpers for the draft e2e scripts (draft-load, draft-chaos, draft-dry-run):
 * backend spawn, auth, REST, a draft WS client, and a final-roster legality audit.
 */
import { resolve } from 'path';
import { Database } from 'bun:sqlite';

export const BACKEND_DIR = resolve(import.meta.dir, '../..');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeChecker() {
  const state = { fails: 0 };
  const check = (cond: boolean, msg: string) => {
    console.log(`${cond ? '  PASS' : '  FAIL'} ${msg}`);
    if (!cond) state.fails++;
    return cond;
  };
  return { check, state };
}

export function startBackend(dbPath: string, port: number, quiet = false) {
  const env: Record<string, string | undefined> = {
    ...process.env, CANNOLI_DB_PATH: dbPath, CANNOLI_MODE: 'mock', PORT: String(port),
  };
  // Never let a harness backend reach real external services.
  for (const k of ['PS_SERVER_WS_URL', 'DISCORD_WEBHOOK_URL', 'DISCORD_ALERT_WEBHOOK']) delete env[k];
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts'], { cwd: BACKEND_DIR, env, stdout: 'pipe', stderr: 'pipe' });
  const pipe = async (s: ReadableStream<Uint8Array>, out: NodeJS.WriteStream, tag: string) => {
    const d = new TextDecoder();
    for await (const c of s) if (!quiet) out.write(`    [${tag}] ${d.decode(c)}`);
  };
  void pipe(proc.stdout, process.stdout, 'be');
  void pipe(proc.stderr, process.stderr, 'be:err');
  const reap = () => { try { proc.kill(); } catch {} };
  process.on('SIGINT', () => { reap(); process.exit(130); });
  process.on('SIGTERM', () => { reap(); process.exit(143); });
  process.on('exit', reap);
  return proc;
}

export async function waitHealthy(base: string, ms = 30000): Promise<boolean> {
  for (let end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch {}
  }
  return false;
}

export type Auth = { cookie: string; csrf: string };

export async function login(base: string, username: string, password: string): Promise<Auth> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${username}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const csrf = (cookie.match(/csrf_token=([^;]+)/) || [])[1] ?? '';
  return { cookie, csrf };
}

export function api(base: string, method: string, path: string, auth: Auth, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Draft WS client. `teamId` null = staff spectator. Records every message it sees. */
export class DraftClient {
  snapshot: any = null;
  picksObserved: { clientRequestId?: string; idempotent?: boolean; auto?: boolean; pickNumber?: number; pokemonName?: string }[] = [];
  errors: { clientRequestId?: string; error: string; code?: string }[] = [];
  private ws!: WebSocket;
  constructor(private wsUrl: string, public teamId: string | null, public username: string, private cookie: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { headers: { Cookie: this.cookie } } as any);
      const t = setTimeout(() => reject(new Error(`${this.username}: draft WS open timeout`)), 10000);
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
      this.ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error(`${this.username}: ws err ${e}`)); });
      this.ws.addEventListener('message', (ev) => {
        let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.type === 'draft_state') this.snapshot = m.data;
        else if (m.type === 'pick_made' || m.type === 'auto_pick') {
          if (m.data?.snapshot) this.snapshot = m.data.snapshot;
          this.picksObserved.push({
            clientRequestId: m.clientRequestId, idempotent: m.idempotent, auto: m.type === 'auto_pick',
            pickNumber: m.data?.pick?.pickNumber, pokemonName: m.data?.pick?.pokemonName,
          });
        } else if (m.type === 'error') this.errors.push({ clientRequestId: m.clientRequestId, error: m.error, code: m.code });
      });
    });
  }
  identify() { this.ws.send(JSON.stringify({ type: 'identify', teamId: this.teamId, username: this.username, role: 'user' })); }
  pick(pokemonName: string, clientRequestId: string, teamId = this.teamId) {
    this.ws.send(JSON.stringify({ type: 'pick', pokemonName, teamId, username: this.username, clientRequestId }));
  }
  close() { try { this.ws.close(); } catch {} }
}

/**
 * Audit final rosters straight from the DB (read-only): budget, roster size, mega cap,
 * no duplicate dex / pokemon, contiguous unique pick numbers. Returns problem strings.
 */
export function auditRosters(
  dbPath: string, leagueId: string,
  rules: { pointCap: number; rosterSize: number; megaCap: number | null },
): { problems: string[]; picks: number; teams: number } {
  const db = new Database(dbPath, { readonly: true });
  try {
    const picks = db.query(`
      SELECT dp.team_id t, dp.pokemon_name n, dp.tier tier, dp.pick_number pn, p.form_category fc, p.national_dex_number dex
      FROM draft_picks dp LEFT JOIN pokemon p ON p.name = dp.pokemon_name
      WHERE dp.league_id = ? ORDER BY dp.pick_number`).all(leagueId) as any[];
    const teamIds = (db.query('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as any[]).map((r) => r.id as string);
    const problems: string[] = [];
    const names = new Set<string>(), nums = new Set<number>();
    for (const p of picks) {
      if (names.has(p.n)) problems.push(`${p.n} drafted twice`);
      names.add(p.n);
      if (nums.has(p.pn)) problems.push(`pick number ${p.pn} applied twice`);
      nums.add(p.pn);
    }
    for (let i = 1; i <= picks.length; i++) if (!nums.has(i)) problems.push(`pick number ${i} missing`);
    for (const t of teamIds) {
      const mine = picks.filter((p) => p.t === t);
      const spent = mine.reduce((s, p) => s + p.tier, 0);
      if (mine.length !== rules.rosterSize) problems.push(`${t}: ${mine.length} picks, expected ${rules.rosterSize}`);
      if (spent > rules.pointCap) problems.push(`${t}: spent ${spent} > cap ${rules.pointCap}`);
      const megas = mine.filter((p) => p.fc === 'mega').length;
      if (rules.megaCap != null && megas > rules.megaCap) problems.push(`${t}: ${megas} megas > ${rules.megaCap}`);
      const dexes = mine.map((p) => p.dex).filter((d) => d != null);
      if (new Set(dexes).size !== dexes.length) problems.push(`${t}: duplicate national dex`);
      const rosterRows = (db.query(`SELECT COUNT(*) c FROM rosters WHERE team_id = ? AND acquired_via = 'draft'`).get(t) as any).c;
      if (rosterRows !== mine.length) problems.push(`${t}: ${rosterRows} roster rows vs ${mine.length} picks`);
    }
    return { problems, picks: picks.length, teams: teamIds.length };
  } finally { db.close(); }
}
