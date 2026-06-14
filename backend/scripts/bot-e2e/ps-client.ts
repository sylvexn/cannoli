/**
 * Scripted Pokemon Showdown client for the bot end-to-end harness.
 *
 * Logs into the live PS server using the SAME RSA-assertion SSO path the real
 * Cannoli backend uses (challstr → signAssertion → /trn), sets a packed team
 * via /utm, then either forfeits or plays the battle to a natural finish by
 * answering every |request| with a legal choice. No human, no browser.
 */
import { signAssertion, toUserid } from '../../src/lib/ps-login';

const PS_URL = process.env.PS_SERVER_WS_URL || 'ws://localhost:8000/showdown/websocket';

/** A 6-mon, all-offense gen9natdexdraft team. All-attacking + Sturdy/no-recover
 *  so a random/first-move bot always terminates (no stall loops). Packed format:
 *  name|species|item|ability|moves|nature|evs|gender|ivs|shiny|level|... */
function packMon(species: string, ability: string, moves: string[]): string {
  return [species, '', '', ability, moves.join(','), '', '', '', '', '', ''].join('|');
}
export const E2E_TEAM = [
  packMon('Garchomp', 'Rough Skin', ['earthquake', 'dragonclaw']),
  packMon('Dragonite', 'Multiscale', ['dragonclaw', 'earthquake']),
  packMon('Tyranitar', 'Sand Stream', ['stoneedge', 'crunch']),
  packMon('Skarmory', 'Sturdy', ['bravebird', 'drillpeck']),
  packMon('Rotom-Wash', 'Levitate', ['hydropump', 'thunderbolt']),
  packMon('Toxapex', 'Regenerator', ['sludgebomb', 'scald']),
].join(']');

type Line = { room: string; parts: string[] };

export class PSClient {
  readonly username: string;
  readonly userid: string;
  private ws!: WebSocket;
  private authed = false;
  battleRoom: string | null = null;
  private play: boolean;
  private onWin?: (winner: string) => void;
  log: (m: string) => void;

  constructor(username: string, opts: { play?: boolean; onWin?: (w: string) => void } = {}) {
    this.username = username;
    this.userid = toUserid(username);
    this.play = opts.play ?? false;
    this.onWin = opts.onWin;
    this.log = (m: string) => console.log(`[ps:${this.userid}] ${m}`);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(PS_URL);
      const authTimer = setTimeout(() => reject(new Error(`${this.userid}: login timed out`)), 20000);
      this.ws.addEventListener('open', () => this.log('connected to PS'));
      this.ws.addEventListener('error', (e) => reject(new Error(`${this.userid}: ws error ${e}`)));
      this.ws.addEventListener('message', (ev) => {
        for (const line of this.parse(String(ev.data))) {
          this.handle(line);
          if (!this.authed && line.parts[1] === 'updateuser' && line.parts[3] === '1'
              && toUserid(line.parts[2]) === this.userid) {
            this.authed = true;
            clearTimeout(authTimer);
            this.log('authenticated');
            resolve();
          }
        }
      });
    });
  }

  private parse(data: string): Line[] {
    const lines = data.split('\n');
    let room = 'lobby';
    const out: Line[] = [];
    let i = 0;
    if (lines[0]?.startsWith('>')) { room = lines[0].slice(1).trim(); i = 1; }
    for (; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === '' || raw == null) continue;
      out.push({ room, parts: raw.split('|') }); // parts[0]='' (leading pipe)
    }
    return out;
  }

  private sendGlobal(cmd: string) { this.ws.send(`|${cmd}`); }
  private sendRoom(room: string, cmd: string) { this.ws.send(`${room}|${cmd}`); }

  private handle(line: Line) {
    const { room, parts } = line;
    const tag = parts[1];

    if (tag === 'challstr') {
      const challstr = `${parts[2]}|${parts[3]}`; // "keyid|challenge"
      const assertion = signAssertion(challstr, this.userid);
      if (!assertion) throw new Error(`${this.userid}: signAssertion returned null (no RSA key?)`);
      this.sendGlobal(`/trn ${this.username},0,${assertion}`);
      return;
    }

    // Track the battle room we get pulled into.
    if (room.startsWith('battle-') && this.battleRoom !== room) {
      this.battleRoom = room;
      this.log(`joined battle room ${room}`);
    }

    if (tag === 'request' && room.startsWith('battle-')) {
      const json = parts.slice(2).join('|');
      if (json) this.answerRequest(room, json);
      return;
    }

    if (tag === 'win') {
      if (room === this.battleRoom) this.onWin?.(parts[2]);
    }
    if (tag === 'error' && room.startsWith('battle-')) {
      this.log(`battle error: ${parts.slice(2).join('|')}`);
    }
    if (tag === 'popup') {
      this.log(`popup: ${parts.slice(2).join('|')}`);
    }
  }

  /** Respond to a |request| with a legal choice (team preview / move / switch). */
  private answerRequest(room: string, jsonStr: string) {
    let req: any;
    try { req = JSON.parse(jsonStr); } catch { return; }
    if (req.wait) return; // opponent's turn to decide; nothing to do
    const rqid = req.rqid ?? '';

    if (req.teamPreview) {
      // Lead with the full team order.
      const n = req.side?.pokemon?.length ?? 6;
      const order = Array.from({ length: n }, (_, i) => i + 1).join('');
      this.choose(room, `team ${order}`, rqid);
      return;
    }

    if (req.forceSwitch) {
      const slot = this.firstSwitchableSlot(req);
      this.choose(room, slot ? `switch ${slot}` : `pass`, rqid);
      return;
    }

    if (req.active) {
      // Singles: one active slot. Pick the first usable move; else switch.
      const moves = req.active[0]?.moves ?? [];
      const idx = moves.findIndex((m: any) => !m.disabled && (m.pp == null || m.pp > 0));
      if (idx >= 0) { this.choose(room, `move ${idx + 1}`, rqid); return; }
      const slot = this.firstSwitchableSlot(req);
      this.choose(room, slot ? `switch ${slot}` : `move 1`, rqid);
    }
  }

  private firstSwitchableSlot(req: any): number | null {
    const team = req.side?.pokemon ?? [];
    for (let i = 0; i < team.length; i++) {
      const p = team[i];
      if (!p.active && !/\bfnt\b/.test(p.condition) && p.condition !== '0 fnt') return i + 1;
    }
    return null;
  }

  private choose(room: string, choice: string, rqid: string | number) {
    if (!this.play) return; // forfeit-mode clients ignore requests
    this.log(`choose ${choice} (rqid ${rqid})`);
    this.sendRoom(room, `/choose ${choice}|${rqid}`);
  }

  setTeam() { this.sendGlobal(`/utm ${E2E_TEAM}`); this.log('team set via /utm'); }
  forfeit() {
    if (!this.battleRoom) { this.log('forfeit: no battle room yet'); return; }
    this.sendRoom(this.battleRoom, '/forfeit');
    this.log(`forfeited ${this.battleRoom}`);
  }
  close() { try { this.ws.close(); } catch {} }
}
