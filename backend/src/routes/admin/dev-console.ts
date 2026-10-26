/** Dev console: Coolify deploy status + live log tail (SSE). Dev role only. */
import { Elysia } from 'elysia';
import { requireDev } from '../../lib/auth-guards';
import { getDeployStatus, selfInfo } from '../../lib/coolify';
import { getLogs, subscribeLogs, type LogLine } from '../../lib/log-buffer';

export const devConsoleRoutes = new Elysia()
  .get('/api/admin/dev/deploys', async () => ({ self: selfInfo(), deploys: await getDeployStatus() }), { beforeHandle: requireDev })
  .get('/api/admin/dev/logs', ({ query }) => ({ lines: getLogs(Math.min(Math.max(parseInt(query.limit ?? '') || 500, 1), 2000)) }), { beforeHandle: requireDev })
  .get('/api/admin/dev/logs/stream', ({ request }) => {
    const enc = new TextEncoder();
    let unsub: (() => void) | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(ctrl) {
        const send = (s: string) => { try { ctrl.enqueue(enc.encode(s)); } catch { /* closed */ } };
        send(': ok\n\n');
        unsub = subscribeLogs((l: LogLine) => send(`data: ${JSON.stringify(l)}\n\n`));
        ping = setInterval(() => send(': ping\n\n'), 20_000);
        request.signal.addEventListener('abort', () => { unsub?.(); clearInterval(ping); try { ctrl.close(); } catch { /* */ } });
      },
      cancel() { unsub?.(); clearInterval(ping); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
  }, { beforeHandle: requireDev });
