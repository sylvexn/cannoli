/**
 * Arena tab — structured match lobby + battle HUD.
 * Shows official match card, scrim lobbies, and live matches.
 * Connects to Arena WS for real-time ready-up and lobby state.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useArenaWebSocket, type ArenaMatch, type LiveMatch, type ScrimLobby } from './use-arena-websocket';
import { Swords, Users, Zap, Plus, LogIn, Loader2 } from 'lucide-react';

export function ArenaTab() {
  const { user } = useAuth();
  const arena = useArenaWebSocket();

  // Initial data from REST (before WS populates)
  const [restMatch, setRestMatch] = useState<ArenaMatch | null>(null);
  const [restLive, setRestLive] = useState<LiveMatch[]>([]);
  const [restScrims, setRestScrims] = useState<ScrimLobby[]>([]);

  useEffect(() => {
    fetch('/api/arena/state', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setRestMatch(data.myMatch);
        setRestLive(data.liveMatches);
        setRestScrims(data.scrimLobbies);
      })
      .catch(() => {});
  }, []);

  // Prefer WS data over REST when available
  const myMatch = arena.myMatch ?? restMatch;
  const liveMatches = arena.liveMatches.length > 0 ? arena.liveMatches : restLive;
  const scrimLobbies = arena.scrimLobbies.length > 0 ? arena.scrimLobbies : restScrims;

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto pr-1">
      {/* Connection indicator */}
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <div className={`w-1.5 h-1.5 rounded-full ${arena.connected ? 'bg-green-400' : 'bg-red-400'}`} />
        {arena.connected ? 'Connected' : 'Reconnecting...'}
      </div>

      {/* Official match card */}
      <OfficialMatchCard
        match={myMatch}
        user={user}
        onReady={arena.readyUp}
        onUnready={arena.unready}
      />

      {/* Scrims */}
      <ScrimsSection
        lobbies={scrimLobbies}
        user={user}
        username={user?.username}
        onCreateScrim={arena.createScrim}
        onJoinScrim={arena.joinScrim}
        onLeaveScrim={arena.leaveScrim}
        onReadyScrim={arena.readyScrim}
      />

      {/* Live matches */}
      <LiveMatchesSection matches={liveMatches} />
    </div>
  );
}

// ─── Official Match Card ──────────────────────────────────────────────────

function OfficialMatchCard({
  match, user, onReady, onUnready,
}: {
  match: ArenaMatch | null;
  user: any;
  onReady: () => void;
  onUnready: () => void;
}) {
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
          {/* Teams display */}
          <div className="flex items-center justify-between">
            <TeamDisplay team={match.homeTeam} isReady={match.readyHome} />
            <span className="text-text-muted text-xs font-mono uppercase">vs</span>
            <TeamDisplay team={match.awayTeam} isReady={match.readyAway} />
          </div>

          {/* Match info */}
          <div className="text-xs text-text-muted text-center">
            Week {match.week} &middot; {match.leagueId.charAt(0).toUpperCase() + match.leagueId.slice(1)} League
            {match.status === 'in_progress' && (
              <span className="ml-2 text-green-400 font-medium">
                <Zap size={10} className="inline" /> LIVE
              </span>
            )}
          </div>

          {/* Ready-up controls */}
          {match.status === 'scheduled' || match.status === 'ready' ? (
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
          ) : match.status === 'in_progress' ? (
            <div className="text-center">
              <span className="text-sm text-green-400 font-medium">Match in progress</span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function TeamDisplay({ team, isReady }: { team: ArenaMatch['homeTeam']; isReady: boolean }) {
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
        <div className="text-sm font-medium text-text-primary">{team.name}</div>
        <div className={`text-xs ${isReady ? 'text-green-400' : 'text-text-muted'}`}>
          {isReady ? '● Ready' : '○ Not ready'}
        </div>
      </div>
    </div>
  );
}

// ─── Scrims Section ───────────────────────────────────────────────────────

function ScrimsSection({
  lobbies, user, username, onCreateScrim, onJoinScrim, onLeaveScrim, onReadyScrim,
}: {
  lobbies: ScrimLobby[];
  user: any;
  username: string | undefined;
  onCreateScrim: (format?: string, invitee?: string) => void;
  onJoinScrim: (id: string) => void;
  onLeaveScrim: (id: string) => void;
  onReadyScrim: (id: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-raised p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            Scrims
          </h2>
        </div>
        {user && (
          <button
            onClick={() => onCreateScrim()}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition-colors"
          >
            <Plus size={12} />
            Create Scrim
          </button>
        )}
      </div>

      {lobbies.length === 0 ? (
        <div className="text-text-muted text-sm">No active scrim lobbies.</div>
      ) : (
        <div className="space-y-2">
          {lobbies.map(lobby => (
            <div
              key={lobby.id}
              className="flex items-center justify-between px-3 py-2 rounded-md bg-surface-overlay text-sm"
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  lobby.status === 'in_progress' ? 'bg-green-400' :
                  lobby.status === 'ready' ? 'bg-yellow-400' :
                  'bg-blue-400'
                }`} />
                <span className="text-text-primary">
                  {lobby.players[0]} vs {lobby.players[1] || '???'}
                </span>
                {lobby.invitee && (
                  <span className="text-xs text-text-muted">(private)</span>
                )}
              </div>

              {lobby.status === 'in_progress' ? (
                <span className="text-xs text-green-400">Live</span>
              ) : lobby.players.includes(username ?? '') ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => onReadyScrim(lobby.id)}
                    className="px-2 py-0.5 text-xs rounded bg-green-400/10 text-green-400 hover:bg-green-400/20"
                  >
                    Ready
                  </button>
                  <button
                    onClick={() => onLeaveScrim(lobby.id)}
                    className="px-2 py-0.5 text-xs rounded bg-red-400/10 text-red-400 hover:bg-red-400/20"
                  >
                    Leave
                  </button>
                </div>
              ) : lobby.players.length < 2 ? (
                <button
                  onClick={() => onJoinScrim(lobby.id)}
                  className="px-2 py-0.5 text-xs rounded bg-blue-400/10 text-blue-400 hover:bg-blue-400/20"
                >
                  Join
                </button>
              ) : (
                <span className="text-xs text-text-muted">Full</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Live Matches Section ─────────────────────────────────────────────────

function LiveMatchesSection({ matches }: { matches: LiveMatch[] }) {
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
              <button className="px-2 py-0.5 text-xs rounded bg-green-400/10 text-green-400 hover:bg-green-400/20">
                Spectate
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
