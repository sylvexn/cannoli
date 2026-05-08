/**
 * OfficialMatchCard — your scheduled match for the current week.
 * Extracted from arena-tab.tsx so it can render standalone inside the
 * Showdown footer.
 */
import { Link } from 'react-router-dom';
import { Swords, LogIn, Loader2, Zap } from 'lucide-react';
import type { ArenaMatch } from '../use-arena-websocket';

interface Props {
  match: ArenaMatch | null;
  user: any;
  onReady: () => void;
  onUnready: () => void;
}

export function OfficialMatchCard({ match, user, onReady, onUnready }: Props) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-raised p-5">
      <div className="flex items-center gap-2 mb-3">
        <Swords size={14} className="text-orange-400" />
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
          This Week's Match
        </h2>
      </div>

      {!user ? (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <LogIn size={14} />
          Log in to see your match.
        </div>
      ) : !match ? (
        <div className="text-text-muted text-sm">
          No match scheduled this week.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <TeamDisplay team={match.homeTeam} isReady={match.readyHome} leagueId={match.leagueId} />
            <span className="text-text-muted text-xs font-mono uppercase">vs</span>
            <TeamDisplay team={match.awayTeam} isReady={match.readyAway} leagueId={match.leagueId} />
          </div>

          <div className="text-xs text-text-muted text-center">
            Week {match.week} &middot; {match.leagueId.charAt(0).toUpperCase() + match.leagueId.slice(1)} League
            {match.status === 'in_progress' && (
              <span className="ml-2 text-green-400 font-medium">
                <Zap size={10} className="inline" /> LIVE
              </span>
            )}
          </div>

          {(match.status === 'scheduled' || match.status === 'ready') && (
            <div className="flex justify-center">
              {(() => {
                const myReady = match.isHome ? match.readyHome : match.readyAway;
                const opponentReady = match.isHome ? match.readyAway : match.readyHome;

                if (match.readyHome && match.readyAway) {
                  return (
                    <div className="flex items-center gap-2 text-green-400 font-medium text-sm">
                      <Loader2 size={14} className="animate-spin" />
                      Both ready — starting match...
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={myReady ? onUnready : onReady}
                      className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                        myReady
                          ? 'bg-green-400/20 text-green-400 border border-green-400/30 hover:bg-red-400/20 hover:text-red-400 hover:border-red-400/30'
                          : 'bg-orange-400/20 text-orange-400 border border-orange-400/30 hover:bg-orange-400/30'
                      }`}
                    >
                      {myReady ? 'Ready ✓ (click to unready)' : 'Ready Up'}
                    </button>
                    {opponentReady && (
                      <span className="text-xs text-green-400 animate-pulse">
                        Opponent is ready!
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          {match.status === 'in_progress' && (
            <div className="text-center">
              <span className="text-sm text-green-400 font-medium">Match in progress</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TeamDisplay({ team, isReady, leagueId }: { team: ArenaMatch['homeTeam']; isReady: boolean; leagueId: string }) {
  if (!team) return <div className="text-text-muted text-sm">TBD</div>;
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold"
        style={{ backgroundColor: team.color + '20', color: team.color }}
      >
        {team.abbrev.toUpperCase()}
      </div>
      <div>
        <Link
          to={`/league/${leagueId}/teams/${team.id}`}
          className="text-sm font-medium text-text-primary hover:text-neon hover:underline transition-colors"
        >
          {team.name}
        </Link>
        <div className={`text-xs ${isReady ? 'text-green-400' : 'text-text-muted'}`}>
          {isReady ? '● Ready' : '○ Not ready'}
        </div>
      </div>
    </div>
  );
}
