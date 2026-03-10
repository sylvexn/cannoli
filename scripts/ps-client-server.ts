/**
 * Dev server for PS client — static files + action.php proxy to Elysia backend.
 *
 * Serves the PS client from showdown/client/play.pokemonshowdown.com/
 * and proxies /~~*/action.php requests to http://localhost:3001/api/ps/action.php
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8080;
const BACKEND_URL = 'http://localhost:3001';
const CLIENT_DIR = join(import.meta.dir, '..', 'showdown', 'client', 'play.pokemonshowdown.com');

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

    // Proxy action.php to our Elysia backend
    if (path.includes('/action.php')) {
      const backendUrl = `${BACKEND_URL}/api/ps/action.php${url.search}`;
      const headers = new Headers(req.headers);
      headers.set('host', 'localhost:3001');

      const resp = await fetch(backendUrl, {
        method: req.method,
        headers,
        body: req.method !== 'GET' ? await req.text() : undefined,
      });

      // Forward response with CORS headers for cross-origin cookies
      const respHeaders = new Headers(resp.headers);
      respHeaders.set('Access-Control-Allow-Origin', `http://localhost:${PORT}`);
      respHeaders.set('Access-Control-Allow-Credentials', 'true');

      return new Response(resp.body, {
        status: resp.status,
        headers: respHeaders,
      });
    }

    // Serve config files from parent config/ dir
    if (path.startsWith('/config/')) {
      const configDir = join(import.meta.dir, '..', 'showdown', 'client', 'config');
      const filePath = join(configDir, path.replace('/config/', ''));
      return serveFile(filePath);
    }

    // Serve static files
    let filePath = join(CLIENT_DIR, path === '/' ? '/testclient.html' : path);

    // If path doesn't exist, try adding .html
    if (!existsSync(filePath)) {
      const withHtml = filePath + '.html';
      if (existsSync(withHtml)) filePath = withHtml;
    }

    return serveFile(filePath);
  },
});

function serveFile(filePath: string): Response {
  if (!existsSync(filePath)) {
    return new Response('Not Found', { status: 404 });
  }

  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    const indexPath = join(filePath, 'index.html');
    if (existsSync(indexPath)) {
      return serveFile(indexPath);
    }
    return new Response('Not Found', { status: 404 });
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  return new Response(readFileSync(filePath), {
    headers: { 'Content-Type': contentType },
  });
}

console.log(`[ps-client] http://localhost:${PORT} (serving ${CLIENT_DIR})`);
