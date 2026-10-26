/** Dev console: Coolify deploy status + live log tail (SSE). Dev role only. */
import { Elysia } from 'elysia';
import { requireDev } from '../../lib/auth-guards';
import { getDeployStatus, selfInfo } from '../../lib/coolify';
import { validateSession, parseSessionToken } from '../../lib/auth';
import { getLogs, subscribeLogs, type LogLine } from '../../lib/log-buffer';

const MAX_BACKLOG = 500; // queued chunks (default count strategy) before lines are dropped

function sessionStillValid(request: Request): boolean {
  const token = parseSessionToken(request.headers.get('cookie') ?? '');
  return !!token && !!validateSession(token);
}

export const devConsoleRoutes = new Elysia()
  .get('/api/admin/dev/deploys', async () => ({ self: selfInfo(), deploys: await getDeployStatus() }), { beforeHandle: requireDev })
  .get('/api/admin/dev/logs', ({ query }) => ({ lines: getLogs(Math.min(Math.max(parseInt(query.limit ?? '') || 500, 1), 2000)) }), { beforeHandle: requireDev })
  .get('/api/admin/dev/logs/stream', ({ request }) => {
    const enc = new TextEncoder();
    let unsub: (() => void) | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(ctrl) {
        // Drop lines when the client is far behind (desiredSize goes negative); pings always go through.
        const send = (s: string, force = false) => {
          try { if (force || (ctrl.desiredSize ?? 1) > -MAX_BACKLOG) ctrl.enqueue(enc.encode(s)); } catch { /* closed */ }
        };
        const close = () => { unsub?.(); clearInterval(ping); try { ctrl.close(); } catch { /* */ } };
        send(': ok\n\n');
        unsub = subscribeLogs((l: LogLine) => send(`data: ${JSON.stringify(l)}\n\n`));
        ping = setInterval(() => {
          if (!sessionStillValid(request)) return close(); // revoked session: end the stream
          send(': ping\n\n', true);
        }, 20_000);
        request.signal.addEventListener('abort', close);
      },
      cancel() { unsub?.(); clearInterval(ping); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
  }, { beforeHandle: requireDev });
