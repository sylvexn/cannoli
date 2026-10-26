/**
 * Read-only Coolify proxy for the dev console deploy table. Token comes from
 * env and never leaves the server. Responses cached ~30s.
 */
import { GIT_SHA } from './version';

export interface DeployApp {
  name: string; fqdn: string | null; status: string; health: 'healthy' | 'degraded' | 'stopped' | 'unknown';
  commit: string | null; image: string | null; lastDeployAt: string | null; deployStatus: string | null;
}
export type DeployStatus =
  | { configured: false }
  | { configured: true; fetchedAt: number; apps: DeployApp[]; error?: string };

const TTL_MS = 30_000;
let cache: { at: number; value: DeployStatus } | null = null;
export const resetCoolifyCache = () => { cache = null; };

export const selfInfo = () => ({
  commit: GIT_SHA, uptimeSeconds: Math.round(process.uptime()),
  mode: process.env.CANNOLI_MODE ?? 'live',
});

function healthOf(status: string): DeployApp['health'] {
  const s = status.toLowerCase();
  if (s.includes('unhealthy') || s.includes('degraded') || s.includes('restarting')) return 'degraded';
  if (s.startsWith('running')) return 'healthy';
  if (s.startsWith('exited') || s.startsWith('stopped')) return 'stopped';
  return 'unknown';
}

export async function getDeployStatus(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<DeployStatus> {
  const base = process.env.COOLIFY_API_URL?.replace(/\/+$/, '');
  const token = process.env.COOLIFY_API_TOKEN;
  if (!base || !token) return { configured: false };
  if (cache && now - cache.at < TTL_MS) return cache.value;

  const get = async (path: string): Promise<any> => {
    const res = await fetchImpl(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Coolify ${path} -> ${res.status}`);
    return res.json();
  };

  try {
    const all = await get('/api/v1/applications');
    const list: any[] = (Array.isArray(all) ? all : []).filter(a => String(a.name ?? '').startsWith('cannoli-'));
    const apps = await Promise.all(list.map(async (a): Promise<DeployApp> => {
      let dep: any = null;
      try {
        const d = await get(`/api/v1/deployments/applications/${a.uuid}`);
        const rows = Array.isArray(d) ? d : d?.deployments;
        dep = Array.isArray(rows) ? rows[0] : null;
      } catch { /* per-app deployment lookup is best-effort */ }
      const status = String(a.status ?? 'unknown');
      return {
        name: a.name, fqdn: a.fqdn ?? null, status, health: healthOf(status),
        commit: (dep?.commit ?? a.git_commit_sha ?? null)?.slice(0, 12) ?? null,
        image: a.docker_registry_image_name ? `${a.docker_registry_image_name}:${a.docker_registry_image_tag ?? 'latest'}` : null,
        lastDeployAt: dep?.finished_at ?? dep?.updated_at ?? dep?.created_at ?? a.updated_at ?? null,
        deployStatus: dep?.status ?? null,
      };
    }));
    const value: DeployStatus = { configured: true, fetchedAt: now, apps: apps.sort((x, y) => x.name.localeCompare(y.name)) };
    cache = { at: now, value };
    return value;
  } catch (e) {
    // Failures aren't cached: next request retries.
    return { configured: true, fetchedAt: now, apps: [], error: e instanceof Error ? e.message : 'Coolify request failed' };
  }
}
