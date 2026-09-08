import { useState } from 'react';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { useLeagueData } from '@/lib/league-data-context';
import { PLAYOFF_ROUND_LABEL, publishTargetWeek } from '@/lib/constants';
import { isStaff } from '@/lib/permissions';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { League } from '@/lib/types';

/**
 * Staff-only header chip: "Publish week N to everyone".
 *
 * Renders ONLY when the admin results-reveal (publish) gate is ON
 * (`league.resultsRevealedThrough != null`) and there are played weeks past it
 * — i.e. unpublished results staff can release league-wide. Clicking bumps the
 * gate up to the last played week (see publishTargetWeek: playoff rounds sit at
 * weeks past currentWeek, which is why the target isn't currentWeek itself).
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
  const { matches } = useLeagueData();
  const [saving, setSaving] = useState(false);

  const gate = league.resultsRevealedThrough;
  const currentWeek = league.season?.currentWeek ?? 0;
  const target = publishTargetWeek(matches, currentWeek);
  // Playoff rounds get named ("quarterfinals"), regular weeks numbered.
  const round = matches.find(m => m.week === target && m.phase === 'playoffs')?.playoffRound;
  const label = round
    ? `${(PLAYOFF_ROUND_LABEL[round] ?? 'Playoff').toLowerCase()}s`
    : `week ${target}`;

  // Only meaningful for staff, when the gate is on and trailing what's played.
  if (!isStaff(user) || gate == null || target <= gate) return null;

  async function reveal() {
    setSaving(true);
    try {
      await api.setResultsReveal(league.id, target);
      toast.success(`Published ${label} results to everyone`);
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
      title={`Publish results through week ${target} for all viewers`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-neon/40 bg-neon/10 px-2.5 py-1 text-xs font-medium text-neon transition-colors',
        'hover:bg-neon/15 disabled:opacity-50',
        className,
      )}
    >
      <Eye className="h-3.5 w-3.5" />
      {saving ? 'Publishing…' : `Publish ${label} to everyone`}
    </button>
  );
}
