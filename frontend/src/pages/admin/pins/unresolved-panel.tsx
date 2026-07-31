/**
 * Post-mint "couldn't resolve" panel. The auto-award job returns entries it
 * couldn't award — an orphaned team ('team-has-no-user'), a manual pin
 * already sitting in the slot ('manual-pin-present'), or nothing clearing
 * the bar this season ('no-eligible-matches', 'no-pokemon-met-kill-floor').
 * These used to be dropped silently, which is how S9 Ruby's championship
 * went missing with no trace — so this renders full-width and stays put
 * until dismissed, instead of folding into a toast count.
 */
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pin } from '@/components/pin';
import type { ApiPinDefinition } from '@/lib/api';

export interface UnresolvedEntry {
  pinDefId: string;
  reason: string;
  teamId?: string | null;
  leagueId?: string | null;
}

const REASON_LABEL: Record<string, string> = {
  'team-has-no-user': 'Team has no assigned coach',
  'manual-pin-present': 'A manual pin already occupies this slot',
  'no-eligible-matches': 'No eligible matches this season',
  'no-pokemon-met-kill-floor': 'No Pokemon cleared the minimum-kills floor',
};

export function UnresolvedPanel({
  entries, defs, onDismiss,
}: {
  entries: UnresolvedEntry[];
  defs: ApiPinDefinition[];
  onDismiss: () => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-md border border-loss/40 bg-loss/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-loss">
          {entries.length} award{entries.length === 1 ? '' : 's'} not minted
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-text-muted hover:text-text-primary"
          onClick={onDismiss}
          title="Dismiss"
        >
          <X size={12} />
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <tbody>
            {entries.map((e, i) => {
              const def = defs.find(d => d.id === e.pinDefId);
              return (
                <tr key={i} className="border-t border-border-subtle first:border-t-0">
                  <td className="py-1 pr-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {def && <Pin def={def} size="xs" noTooltip />}
                      <span style={{ color: def?.color }}>{def?.name ?? e.pinDefId}</span>
                    </span>
                  </td>
                  <td className="py-1 pr-3 text-text-secondary">
                    {REASON_LABEL[e.reason] ?? e.reason}
                  </td>
                  <td className="py-1 pr-0 font-mono text-text-muted whitespace-nowrap">
                    {e.teamId && e.teamId.toUpperCase()}
                    {e.leagueId && ` · ${e.leagueId}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
