/**
 * LiveMatchesSection — list of in-progress official matches. "Watch" opens the
 * battle in the Showdown client (a new tab), never a second in-page PS client.
 * Extracted from arena-tab.tsx for the Showdown footer.
 */
import { Zap, ExternalLink } from 'lucide-react';
import type { LiveMatch } from '../use-arena-websocket';

interface Props {
  matches: LiveMatch[];
  onWatch: (match: LiveMatch) => void;
}

export function LiveMatchesSection({ matches, onWatch }: Props) {
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
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-surface-overlay text-sm"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Zap size={12} className="text-green-400 shrink-0" />
                <span className="text-text-primary truncate min-w-0 flex-1">
                  Week {m.week}: {m.homeTeam?.name ?? '?'} vs {m.awayTeam?.name ?? '?'}
                </span>
                <span className="text-xs text-text-muted capitalize shrink-0">{m.leagueId}</span>
              </div>
              <button
                onClick={() => onWatch(m)}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-green-400/10 text-green-400 hover:bg-green-400/20 transition-colors shrink-0"
                title="Watch in the Showdown client (opens a new tab)"
              >
                Watch
                <ExternalLink size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
