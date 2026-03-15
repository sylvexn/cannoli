/**
 * Global Playwright setup — wipes and reseeds the mock DB before the suite.
 * Runs once per test invocation.
 */
import { spawnSync } from 'child_process';

export default async function globalSetup() {
  console.log('[playwright] reseeding mock DB...');
  const result = spawnSync('bun', ['run', '--cwd', 'backend', 'seed:fresh'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, CANNOLI_MODE: 'mock' },
  });
  if (result.status !== 0) {
    throw new Error(`seed:fresh failed (exit ${result.status})`);
  }
  console.log('[playwright] DB ready.');
}
