/** Dev console API client (dev role only). Kept out of api.ts on purpose. */
const API_BASE = import.meta.env.VITE_API_URL || '';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface DevLogLine { boot: string; n: number; t: number; src: 'backend' | 'ps-bot'; level: LogLevel; msg: string }
export interface DeployApp {
  name: string; fqdn: string | null; status: string; health: 'healthy' | 'degraded' | 'stopped' | 'unknown';
  commit: string | null; image: string | null; lastDeployAt: string | null; deployStatus: string | null;
}
export type DeployStatus = { configured: false } | { configured: true; fetchedAt: number; apps: DeployApp[]; error?: string };
export interface DevDeploys { self: { commit: string; uptimeSeconds: number; mode: string }; deploys: DeployStatus }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export const devConsoleApi = {
  deploys: () => get<DevDeploys>('/api/admin/dev/deploys'),
  logs: (limit = 500) => get<{ lines: DevLogLine[] }>(`/api/admin/dev/logs?limit=${limit}`),
  streamUrl: () => `${API_BASE}/api/admin/dev/logs/stream`,
};
