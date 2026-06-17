import { useState } from 'react';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { isStaff } from '@/lib/permissions';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { League } from '@/lib/types';

/**
 * Staff-only header chip: "Publish week N to everyone".
 *
 * Renders ONLY when the admin results-reveal (publish) gate is ON
 * (`league.resultsRevealedThrough != null`) and the current week is still
 * behind the gate (`currentWeek > resultsRevealedThrough`) — i.e. there are
 * unpublished results staff can release league-wide. Clicking bumps the gate
 * up to the current week.
 *
 * After a successful publish we re-fetch BOTH `/api/leagues` (so the new gate
 * line propagates) and — via the optional `onRevealed` callback — the page's
 * gated team/standings data. The `/api/leagues/:id/teams` response is
 * CDN-cached on this deployment, so the caller's refetch is what actually
 * pulls the now-published records/order.
 */
export function ResultsRevealQuickAction({
  league,
  onRevealed,
  className,
}: {
  league: League;
  /** Page-local refetch of gated data (e.g. useLeagueData().refresh). */
  onRevealed?: () => void | Promise<void>;
  className?: string;
}) {
  const { user } = useAuth();
  const { refreshLeagues } = useAppData();
  const [saving, setSaving] = useState(false);

  const gate = league.resultsRevealedThrough;
  const currentWeek = league.season?.currentWeek ?? 0;

  // Only meaningful for staff, when the gate is on and trailing the live week.
  if (!isStaff(user) || gate == null || currentWeek <= gate) return null;

  async function reveal() {
    setSaving(true);
    try {
      await api.setResultsReveal(league.id, currentWeek);
      toast.success(`Published Week ${currentWeek} results to everyone`);
      // Refresh the league cache (updates the publish gate line) and the page's
      // gated data (records/standings) — /teams is CDN-cached so we must refetch.
      refreshLeagues();
      await onRevealed?.();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={reveal}
      disabled={saving}
      title={`Publish results through Week ${currentWeek} for all viewers`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-neon/40 bg-neon/10 px-2.5 py-1 text-xs font-medium text-neon transition-colors',
        'hover:bg-neon/15 disabled:opacity-50',
        className,
      )}
    >
      <Eye className="h-3.5 w-3.5" />
      {saving ? 'Publishing…' : `Publish week ${currentWeek} to everyone`}
    </button>
  );
}
