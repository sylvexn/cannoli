/**
 * Background-job trigger card for the Simulator tab.
 *
 * One button per scheduled job, fired on demand via POST /api/admin/jobs/:name/run.
 * Useful while simulating a season — auto-forfeit / advance-week / etc. normally
 * run on a cron, but the simulator lets an admin pull them forward.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Gavel, CalendarClock, AlarmClock, Hourglass, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

interface JobDef {
  name: string;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const JOBS: JobDef[] = [
  { name: 'auto-forfeit',      label: 'Auto-Forfeit',      desc: 'Forfeit matches past their deadline', icon: Gavel },
  { name: 'advance-week',      label: 'Advance Week',      desc: 'Roll leagues whose week window elapsed', icon: CalendarClock },
  { name: 'stale-in-progress', label: 'Stale In-Progress', desc: 'Clear matches stuck in progress', icon: AlarmClock },
  { name: 'expire-trades',     label: 'Expire Trades',     desc: 'Expire pending trades past their TTL', icon: Hourglass },
];

export function JobTriggerCard() {
  const [busy, setBusy] = useState<string | null>(null);

  async function runJob(job: JobDef) {
    setBusy(job.name);
    try {
      await api.runJob(job.name);
      toast.success(`Job "${job.label}" ran`);
    } catch (err: any) {
      toast.error(err?.message ?? `Job "${job.label}" failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {JOBS.map(job => {
        const Icon = job.icon;
        return (
          <div
            key={job.name}
            className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface-overlay/40 p-2.5"
          >
            <div className="min-w-0">
              <div className="text-[11px] font-mono font-bold uppercase tracking-wide text-text-primary flex items-center gap-1.5">
                <Icon size={12} className="text-neon shrink-0" />
                {job.label}
              </div>
              <div className="text-[10px] text-text-muted mt-0.5 truncate">
                {job.desc}
              </div>
            </div>
            <Button
              variant="outline" size="sm"
              className="h-7 text-[11px] shrink-0"
              disabled={busy !== null}
              onClick={() => runJob(job)}
            >
              <Play size={12} />
              {busy === job.name ? 'Running…' : 'Run'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
