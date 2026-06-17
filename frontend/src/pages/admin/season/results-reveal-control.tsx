import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { NumberInput } from '@/components/ui/number-input';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

/**
 * Admin per-league results-reveal gate control.
 *
 * `resultsRevealedThrough = null` → gate OFF, all results visible. An integer
 * N hides results for weeks > N for EVERYONE (standings/records computed only
 * through week N server-side). The backend clamps to [0, currentWeek].
 *
 * UI: an Off / On toggle pair; when On, a NumberInput bounded to [0, currentWeek]
 * sets the revealed-through line. Every change POSTs immediately and calls
 * `onChanged` so the app-wide league cache (and thus every <Spoiler> + the
 * CDN-cached /teams reads it gates) re-fetches.
 */
export function ResultsRevealControl({
  leagueId,
  currentWeek,
  value,
  onChanged,
}: {
  leagueId: string;
  currentWeek: number;
  /** Current gate value: null = off, integer = revealed-through week. */
  value: number | null;
  /** Called after a successful mutation so the parent can refresh leagues. */
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const isOn = value != null;

  async function commit(next: number | null) {
    setSaving(true);
    try {
      await api.setResultsReveal(leagueId, next);
      toast.success(
        next == null
          ? 'Results gate off — all results visible'
          : `Results revealed through Week ${next}`,
      );
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border-subtle bg-surface-overlay/30 p-3">
      <div className="flex items-center gap-2 text-sm">
        <Lock size={14} className="text-text-muted" />
        <span className="text-text-primary font-medium">Results Reveal Gate</span>
        <span
          className={cn(
            'ml-auto text-[10px] font-mono uppercase tracking-wider',
            isOn ? 'text-draw' : 'text-text-muted',
          )}
        >
          {isOn ? `Hidden past W${value}` : 'Off'}
        </span>
      </div>

      <p className="text-[10px] text-text-muted">
        Hide results for weeks past the revealed line from everyone. Standings and
        records compute only through that week until you reveal further.
      </p>

      <div className="flex items-center gap-2">
        {/* Off / On toggle */}
        <div className="flex rounded-md border border-border-default overflow-hidden">
          <button
            type="button"
            disabled={saving}
            onClick={() => commit(null)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              !isOn
                ? 'bg-surface-overlay text-text-primary'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
            )}
          >
            <Eye size={12} />
            Off
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => commit(isOn ? value! : currentWeek)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              isOn
                ? 'bg-draw/10 text-draw'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
            )}
          >
            <EyeOff size={12} />
            On
          </button>
        </div>

        {/* Revealed-through week — only when the gate is on */}
        {isOn && (
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="whitespace-nowrap">Revealed through week</span>
            <NumberInput
              value={value!}
              onChange={v => commit(v)}
              min={0}
              max={currentWeek}
              disabled={saving}
              className="w-20"
            />
          </label>
        )}
      </div>
    </div>
  );
}
