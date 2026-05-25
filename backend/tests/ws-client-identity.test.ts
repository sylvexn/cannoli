/**
 * Root-cause regression for LAUNCH-BUG: arena-ws-client-identity.
 *
 * Both routes/arena.ts and routes/draft.ts track per-connection state in
 * `Map`/`Set`/`WeakMap` collections keyed on the Elysia `ws` object:
 *   - arena.ts:  arenaClients (Map<ws, ArenaClient>), matchSpectators (Set<ws>)
 *   - draft.ts:  leaguePresence (Map<leagueId, Map<ws, …>>),
 *                chatRateLimit (WeakMap<ws, number[]>)
 *
 * That pattern assumes the SAME `ws` object instance is handed to `open`,
 * `message`, and `close`. Under the installed Elysia (1.4.28; package.json
 * still pins ^1.2.0) that assumption is FALSE: each lifecycle callback receives
 * a freshly-wrapped ServerWebSocket. The underlying `ws.raw` and `ws.id` are
 * stable, but the wrapper identity is not — so a `.get(ws)` in `message` never
 * finds the entry inserted by `.set(ws, …)` in `open`.
 *
 * Observable downstream breakage (see arena-ws.test.ts skipped specs):
 *   - match_ready / scrim_* handlers bail at `arenaClients.get(ws)` → undefined.
 *   - close() can't remove presence/spectator entries → leaks + stale counts.
 *
 * This test pins the bug at the framework boundary so the fix (re-key the
 * collections on `ws.id`) is unambiguous and so a future Elysia upgrade that
 * restores wrapper identity is detected. It is intentionally NOT skipped: it
 * asserts the CURRENT (buggy) behavior, and is the canary that flips when the
 * platform or a source fix changes the contract.
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { Elysia } from 'elysia';

interface Caught {
  openWs?: object;
  messageWs?: object;
  closeWs?: object;
  rawStable?: boolean;
  idStable?: boolean;
  mapHitInMessage?: boolean;
}

const caught: Caught = {};
const wsMap = new Map<object, string>();

const app = new Elysia().ws('/ws/identity', {
  open(ws) {
    caught.openWs = ws;
    wsMap.set(ws, 'set-in-open');
  },
  message(ws) {
    caught.messageWs = ws;
    caught.rawStable = (caught.openWs as any)?.raw === (ws as any)?.raw;
    caught.idStable = (caught.openWs as any)?.id === (ws as any)?.id;
    caught.mapHitInMessage = wsMap.has(ws);
  },
  close(ws) {
    caught.closeWs = ws;
  },
}).listen(0);
const port = (app.server as any).port;

afterAll(() => app.stop());

function exercise(): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/identity`);
    ws.onopen = () => ws.send('ping');
    ws.onmessage = () => {};
    // Give the server a beat to process the message, then close.
    setTimeout(() => {
      ws.close();
      setTimeout(resolve, 80);
    }, 120);
  });
}

describe('Elysia ws wrapper identity (LAUNCH-BUG: arena-ws-client-identity)', () => {
  test('the `ws` wrapper in message() is NOT the same object as in open()', async () => {
    await exercise();
    expect(caught.openWs).toBeDefined();
    expect(caught.messageWs).toBeDefined();
    // The bug: different wrapper instances per callback.
    expect(caught.openWs === caught.messageWs).toBe(false);
  });

  test('a Map keyed on the open() ws is a MISS in message() — the exact failure mode', async () => {
    await exercise();
    expect(caught.mapHitInMessage).toBe(false);
  });

  test('ws.raw and ws.id ARE stable across callbacks → the fix is to key on ws.id', async () => {
    await exercise();
    expect(caught.rawStable).toBe(true);
    expect(caught.idStable).toBe(true);
  });
});
