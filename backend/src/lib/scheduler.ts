/**
 * In-process scheduler for periodic jobs.
 * Single-VPS, single-process — no queue/Redis needed.
 *
 * Jobs are idempotent (driven by DB state, not timer state) so a restart
 * just resumes from current DB state without losing work.
 */

import { runAutoForfeit } from './jobs/auto-forfeit';
import { runAdvanceWeek } from './jobs/advance-week';

interface JobDef {
  name: string;
  intervalMs: number;
  fn: () => void | Promise<void>;
}

const JOBS: JobDef[] = [
  // Run auto-forfeit first so a forfeit-as-result is in place before advance-week scans
  { name: 'auto-forfeit', intervalMs: 10 * 60 * 1000, fn: runAutoForfeit },
  { name: 'advance-week', intervalMs: 60 * 60 * 1000, fn: runAdvanceWeek },
];

const handles: NodeJS.Timeout[] = [];

export function startSchedulers() {
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
