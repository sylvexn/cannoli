/**
 * Cloudflare R2 uploads via the Cloudflare REST API (bearer-token auth).
 * Avoids the AWS SigV4 dance — for our low-volume asset writes the REST API
 * is plenty.
 *
 * Env:
 *   R2_ACCOUNT_ID   — CF account id
 *   R2_BUCKET       — bucket name (e.g. "cannoli")
 *   R2_API_TOKEN    — account-owned token with R2 read/write
 *   R2_PUBLIC_URL   — public base, no trailing slash (e.g. "https://cdn.cannoli.live")
 *
 * isR2Configured() returns false if any are missing — callers fall back to disk.
 */

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const BUCKET = process.env.R2_BUCKET;
const TOKEN = process.env.R2_API_TOKEN;
const PUBLIC_BASE = process.env.R2_PUBLIC_URL?.replace(/\/+$/, '');

export function isR2Configured(): boolean {
  return !!(ACCOUNT && BUCKET && TOKEN && PUBLIC_BASE);
}

export function r2PublicUrl(key: string): string {
  if (!PUBLIC_BASE) throw new Error('R2_PUBLIC_URL not set');
  return `${PUBLIC_BASE}/${key.replace(/^\/+/, '')}`;
}

export async function r2Put(
  key: string,
  body: Blob | ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  if (!isR2Configured()) throw new Error('R2 not configured');
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURI(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': contentType,
    },
    body: body as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function r2Delete(key: string): Promise<void> {
  if (!isR2Configured()) throw new Error('R2 not configured');
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURI(key)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 DELETE ${key} failed: ${res.status} ${text.slice(0, 200)}`);
  }
}
