/**
 * Shared WebSocket broadcaster.
 *
 * Both the draft and arena WS routers need to publish to topics from code
 * that runs OUTSIDE a WS handler — HTTP endpoints (draft start/pick/auto-pick),
 * timers (ready-up timeout, draft timer expiry), and the PS bot result writer.
 *
 * The old approach captured one connection's `ws` object as a module-level
 * `broadcastWs` and called `broadcastWs.publish(...)`. That handle goes stale:
 * it's never reset on close, so after that socket leaves we publish through a
 * dead connection. Draft overwrote it on every `open` (last-wins), arena set it
 * only-if-null (first-wins) — both broken once the captured socket disconnects.
 *
 * The fix: publish through the Bun `Server` instance. Bun's pub/sub is owned by
 * the server, not by any individual socket, so `server.publish(topic, data)`
 * reaches every subscriber regardless of which connections are alive. We capture
 * the server once on `.onStart` (see `registerBroadcastServer`).
 *
 * Topics are plain strings; both routers subscribe their sockets to the same
 * namespace, so a single server handles all of them.
 */

interface PublishableServer {
  publish(topic: string, data: string | BufferSource, compress?: boolean): number;
}

let server: PublishableServer | null = null;

/**
 * Capture the Bun server instance. Call once from each router's `.onStart`
 * (idempotent — the first non-null server wins; subsequent calls are no-ops as
 * the same process has a single server). Safe to call from multiple routers.
 */
export function registerBroadcastServer(s: PublishableServer | null | undefined) {
  if (s && !server) server = s;
}

/**
 * Publish a message to a topic via the server pub/sub. No-ops if the server
 * isn't up yet (e.g. a timer fires during boot before `.onStart`). Returns
 * true if a server was available to publish through.
 */
export function publishWs(topic: string, data: string): boolean {
  if (!server) return false;
  try {
    server.publish(topic, data);
    return true;
  } catch {
    // A transient publish failure (e.g. server restarting) must never crash a
    // timer or HTTP handler. Subscribers will re-sync on their next snapshot.
    return false;
  }
}

/** Whether a server is currently registered (useful for guard checks). */
export function hasBroadcastServer(): boolean {
  return server !== null;
}

/** Test-only: reset the captured server so a fresh harness can re-register. */
export function __resetBroadcastServerForTests() {
  server = null;
}
