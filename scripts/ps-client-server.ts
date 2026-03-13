// Dev server for PS client: static files + action.php proxy to Elysia backend.
// Serves PS client from showdown/client/play.pokemonshowdown.com/
// Proxies action.php requests to http://localhost:3001/api/ps/action.php
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8080;
const BACKEND_URL = 'http://localhost:3001';
const CLIENT_ROOT = join(import.meta.dir, '..', 'showdown', 'client');
const CLIENT_PLAY = join(CLIENT_ROOT, 'play.pokemonshowdown.com');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Proxy action.php to our Elysia backend (same-origin cookie relay)
    if (path.includes('/action.php')) {
      const backendUrl = `${BACKEND_URL}/api/ps/action.php${url.search}`;

      // Forward essential headers: cookies, content-type, body
      const proxyHeaders: Record<string, string> = {
        'host': 'localhost:3001',
      };
      const cookie = req.headers.get('cookie');
      if (cookie) proxyHeaders['cookie'] = cookie;
      const contentType = req.headers.get('content-type');
      if (contentType) {
        // Strip "; charset=UTF-8" — Elysia doesn't parse form bodies with charset suffix
        proxyHeaders['content-type'] = contentType.split(';')[0].trim();
      }

      const resp = await fetch(backendUrl, {
        method: req.method,
        headers: proxyHeaders,
        body: req.method !== 'GET' ? await req.arrayBuffer() : undefined,
      });

      // Relay response headers — especially Set-Cookie from backend
      const respHeaders = new Headers();
      respHeaders.set('Content-Type', resp.headers.get('Content-Type') || 'text/plain');
      // Forward all Set-Cookie headers so sid cookie lands on localhost:8080
      resp.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          respHeaders.append('Set-Cookie', value);
        }
      });

      return new Response(resp.body, {
        status: resp.status,
        headers: respHeaders,
      });
    }

    // Root serves testclient.html from the play subdirectory
    if (path === '/') {
      return serveFile(join(CLIENT_PLAY, 'testclient.html'));
    }

    // Try play subdirectory first (html, compiled js, css, images)
    const playPath = join(CLIENT_PLAY, path);
    if (existsSync(playPath) && !statSync(playPath).isDirectory()) {
      return serveFile(playPath);
    }

    // Then try repo root (data/, js/server/, config/)
    const rootPath = join(CLIENT_ROOT, path);
    if (existsSync(rootPath) && !statSync(rootPath).isDirectory()) {
      return serveFile(rootPath);
    }

    // Directory index fallback
    for (const base of [playPath, rootPath]) {
      const indexPath = join(base, 'index.html');
      if (existsSync(indexPath)) return serveFile(indexPath);
    }

    return new Response('Not Found', { status: 404 });
  },
});

function serveFile(filePath: string): Response {
  if (!existsSync(filePath)) {
    return new Response('Not Found', { status: 404 });
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  return new Response(readFileSync(filePath), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}

console.log(`[ps-client] http://localhost:${PORT}`);
