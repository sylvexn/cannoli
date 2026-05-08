/**
 * LiveMatchesSection — list of in-progress official matches with spectate.
 * Extracted from arena-tab.tsx for the Showdown footer.
 */
import { Zap } from 'lucide-react';
import type { LiveMatch } from '../use-arena-websocket';

interface Props {
  matches: LiveMatch[];
  onSpectate: (match: LiveMatch) => void;
}

export function LiveMatchesSection({ matches, onSpectate }: Props) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-raised p-5">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={14} className="text-green-400" />
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
          Live Now
        </h2>
      </div>

      {matches.length === 0 ? (
        <div className="text-text-muted text-sm">No matches in progress.</div>
      ) : (
        <div className="space-y-2">
          {matches.map(m => (
            <div
              key={m.matchId}
              className="flex items-center justify-between px-3 py-2 rounded-md bg-surface-overlay text-sm"
            >
              <div className="flex items-center gap-2">
                <Zap size={12} className="text-green-400" />
                <span className="text-text-primary">
                  Week {m.week}: {m.homeTeam?.name ?? '?'} vs {m.awayTeam?.name ?? '?'}
                </span>
                <span className="text-xs text-text-muted capitalize">{m.leagueId}</span>
              </div>
              <button
                onClick={() => onSpectate(m)}
                className="px-2 py-0.5 text-xs rounded bg-green-400/10 text-green-400 hover:bg-green-400/20 transition-colors"
              >
                Spectate
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
