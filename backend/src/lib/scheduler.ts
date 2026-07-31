/**
 * In-process scheduler for periodic jobs.
 * Single-VPS, single-process — no queue/Redis needed.
 *
 * Jobs are idempotent (driven by DB state, not timer state) so a restart
 * just resumes from current DB state without losing work.
 */

import { runAutoForfeit } from './jobs/auto-forfeit';
import { runAdvanceWeek } from './jobs/advance-week';
import { runExpireTrades } from './jobs/expire-trades';
import { runStaleInProgressSweep } from './jobs/stale-in-progress';
import { runUsageRollup } from './usage';
import { applyDueTransactions } from './scheduled-transactions';

interface JobDef {
  name: string;
  intervalMs: number;
  fn: () => void | Promise<void>;
}

const JOBS: JobDef[] = [
  // Run auto-forfeit first so a forfeit-as-result is in place before advance-week scans
  { name: 'auto-forfeit', intervalMs: 10 * 60 * 1000, fn: runAutoForfeit },
  { name: 'stale-in-progress', intervalMs: 10 * 60 * 1000, fn: runStaleInProgressSweep },
  { name: 'advance-week', intervalMs: 60 * 60 * 1000, fn: runAdvanceWeek },
  // Runs after advance-week so a week that just opened picks up its scheduled
  // trades/FA moves in the same tick. Idempotent — no-ops when nothing is due.
  { name: 'apply-scheduled', intervalMs: 60 * 60 * 1000, fn: () => { applyDueTransactions(); } },
  { name: 'expire-trades', intervalMs: 60 * 60 * 1000, fn: runExpireTrades },
  { name: 'usage-rollup', intervalMs: 60 * 60 * 1000, fn: runUsageRollup },
];

const handles: NodeJS.Timeout[] = [];

/**
 * Whether the scheduler should run jobs in this process.
 *
 * Precedence:
 *   1. CANNOLI_DISABLE_SCHEDULERS=1 → always disabled
 *   2. CANNOLI_FORCE_SCHEDULERS=1   → always enabled (overrides dev default)
 *   3. NODE_ENV !== 'production'    → disabled by default (so `bun dev`
 *      doesn't run forfeit + week-advance jobs against the dev DB)
 *   4. otherwise (production)       → enabled
 */
function schedulersEnabled(): { enabled: boolean; reason: string } {
  if (process.env.CANNOLI_DISABLE_SCHEDULERS === '1') {
    return { enabled: false, reason: 'CANNOLI_DISABLE_SCHEDULERS=1' };
  }
  if (process.env.CANNOLI_FORCE_SCHEDULERS === '1') {
    return { enabled: true, reason: 'CANNOLI_FORCE_SCHEDULERS=1' };
  }
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv !== 'production') {
    return { enabled: false, reason: `NODE_ENV=${nodeEnv} (set CANNOLI_FORCE_SCHEDULERS=1 to enable)` };
  }
  return { enabled: true, reason: 'NODE_ENV=production' };
}

export function startSchedulers() {
  const gate = schedulersEnabled();
  if (!gate.enabled) {
    console.log(`[scheduler] skipping job registration — ${gate.reason}`);
    return;
  }

  for (const job of JOBS) {
    const h = setInterval(() => {
      Promise.resolve(job.fn()).catch(err => {
        console.error(`[scheduler] ${job.name} failed:`, err);
      });
    }, job.intervalMs);
    handles.push(h);
    console.log(`[scheduler] registered ${job.name} (every ${job.intervalMs / 1000}s)`);
  }
}

export function stopSchedulers() {
  for (const h of handles) clearInterval(h);
  handles.length = 0;
}

/** Manually run a job by name (for admin tools / tests). Returns whether the job exists. */
export async function runOnce(name: string): Promise<boolean> {
  const job = JOBS.find(j => j.name === name);
  if (!job) return false;
  await job.fn();
  return true;
}
