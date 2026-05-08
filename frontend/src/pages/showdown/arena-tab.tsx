/**
 * Arena tab — structured match lobby + battle HUD.
 * Shows official match card, scrim lobbies, and live matches.
 * Connects to Arena WS for real-time ready-up and lobby state.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useArenaWebSocket, type ArenaMatch, type LiveMatch, type ScrimLobby } from './use-arena-websocket';
import { BattleHud } from './battle-hud';
import { Swords, Users, Zap, Plus, LogIn, Loader2, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ──��� Player type from /api/arena/players ────────────────────────────────────

interface ArenaPlayer {
  username: string;
  teamName: string;
  teamAbbrev: string;
  leagueId: string;
}

// ─── Main Component ─────────────────────────────────────────────────────────

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

  // Active battle view (null = lobby, set when viewing a live match)
  const [viewingBattle, setViewingBattle] = useState<{
    matchId: string;
    psRoomId: string | null;
    isOfficial: boolean;
    label: string;
  } | null>(null);

  // Prefer WS data over REST when available
  const myMatch = arena.myMatch ?? restMatch;
  const liveMatches = arena.liveMatches.length > 0 ? arena.liveMatches : restLive;
  const scrimLobbies = arena.scrimLobbies.length > 0 ? arena.scrimLobbies : restScrims;

  // Auto-enter HUD when our match goes in_progress
  useEffect(() => {
    if (myMatch?.status === 'in_progress' && myMatch.psRoomId && !viewingBattle) {
      const home = myMatch.homeTeam?.name ?? 'Home';
      const away = myMatch.awayTeam?.name ?? 'Away';
      setViewingBattle({
        matchId: myMatch.matchId,
        psRoomId: myMatch.psRoomId,
        isOfficial: true,
        label: `Week ${myMatch.week}: ${home} vs ${away}`,
      });
    }
  }, [myMatch?.status, myMatch?.psRoomId]);

  // Battle HUD mode
  if (viewingBattle) {
    return (
      <BattleHud
        matchId={viewingBattle.matchId}
        psRoomId={viewingBattle.psRoomId}
        isOfficial={viewingBattle.isOfficial}
        label={viewingBattle.label}
        liveStats={arena.liveStats}
        spectatorCount={arena.spectatorCounts[viewingBattle.matchId]}
        onBackToLobby={() => setViewingBattle(null)}
      />
    );
  }

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
      <LiveMatchesSection
        matches={liveMatches}
        onSpectate={(m) => {
          const home = m.homeTeam?.name ?? 'Home';
          const away = m.awayTeam?.name ?? 'Away';
          setViewingBattle({
            matchId: m.matchId,
            psRoomId: m.psRoomId,
            isOfficial: true,
            label: `Week ${m.week}: ${home} vs ${away}`,
          });
          arena.subscribeMatch(m.matchId);
        }}
      />
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
                      {myReady ? 'Ready \u2713 (click to unready)' : 'Ready Up'}
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
          {isReady ? '\u25cf Ready' : '\u25cb Not ready'}
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
  const [dialogOpen, setDialogOpen] = useState(false);

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
            onClick={() => setDialogOpen(true)}
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
            <ScrimLobbyRow
              key={lobby.id}
              lobby={lobby}
              username={username}
              onJoin={onJoinScrim}
              onLeave={onLeaveScrim}
              onReady={onReadyScrim}
            />
          ))}
        </div>
      )}

      <CreateScrimDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentUsername={username}
        onCreateScrim={(format, invitee) => {
          onCreateScrim(format, invitee);
          setDialogOpen(false);
        }}
      />
    </section>
  );
}

function ScrimLobbyRow({
  lobby, username, onJoin, onLeave, onReady,
}: {
  lobby: ScrimLobby;
  username: string | undefined;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
  onReady: (id: string) => void;
}) {
  const isInLobby = lobby.players.includes(username ?? '');
  const myIdx = lobby.players.indexOf(username ?? '');
  const amReady = myIdx >= 0 && lobby.ready[myIdx];

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md bg-surface-overlay text-sm">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          lobby.status === 'in_progress' ? 'bg-green-400' :
          lobby.status === 'ready' ? 'bg-yellow-400' :
          'bg-blue-400'
        }`} />
        <span className="text-text-primary">
          {lobby.players[0]}{' '}
          <span className="text-text-muted">vs</span>{' '}
          {lobby.players[1] || (
            <span className="text-text-muted italic">waiting...</span>
          )}
        </span>
        {lobby.invitee && (
          <span className="text-xs text-text-muted">(invite only)</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {lobby.status === 'in_progress' ? (
          <span className="text-xs text-green-400 font-medium">Live</span>
        ) : isInLobby ? (
          <>
            <button
              onClick={() => onReady(lobby.id)}
              disabled={amReady}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                amReady
                  ? 'bg-green-400/20 text-green-400 cursor-default'
                  : 'bg-green-400/10 text-green-400 hover:bg-green-400/20'
              }`}
            >
              {amReady ? 'Ready \u2713' : 'Ready'}
            </button>
            <button
              onClick={() => onLeave(lobby.id)}
              className="px-2 py-0.5 text-xs rounded bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-colors"
            >
              Leave
            </button>
          </>
        ) : lobby.players.length < 2 ? (
          <button
            onClick={() => onJoin(lobby.id)}
            className="px-2 py-0.5 text-xs rounded bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition-colors"
          >
            Join
          </button>
        ) : (
          <span className="text-xs text-text-muted">Full</span>
        )}
      </div>
    </div>
  );
}

// ─── Create Scrim Dialog ──────────────────────────────────────────────────

function CreateScrimDialog({
  open, onOpenChange, currentUsername, onCreateScrim,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUsername: string | undefined;
  onCreateScrim: (format: string, invitee?: string) => void;
}) {
  const [mode, setMode] = useState<'open' | 'invite'>('open');
  const [players, setPlayers] = useState<ArenaPlayer[]>([]);
  const [search, setSearch] = useState('');
  const [selectedInvitee, setSelectedInvitee] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load players when opening in invite mode
  useEffect(() => {
    if (!open) {
      setMode('open');
      setSearch('');
      setSelectedInvitee(null);
      return;
    }
    setLoading(true);
    fetch('/api/arena/players', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setPlayers(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const filteredPlayers = players.filter(p =>
    p.username !== currentUsername &&
    (p.username.toLowerCase().includes(search.toLowerCase()) ||
     p.teamName.toLowerCase().includes(search.toLowerCase())),
  );

  const handleCreate = () => {
    onCreateScrim('gen9natdexdraft', mode === 'invite' ? selectedInvitee ?? undefined : undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface-raised border-border-default max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">
            <span className="text-blue-400">Create</span> Scrim
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode selector */}
          <div className="flex gap-2">
            <button
              onClick={() => { setMode('open'); setSelectedInvitee(null); }}
              className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'open'
                  ? 'bg-blue-400/15 text-blue-400 border border-blue-400/30'
                  : 'bg-surface-overlay text-text-secondary hover:text-text-primary'
              }`}
            >
              Open Lobby
            </button>
            <button
              onClick={() => setMode('invite')}
              className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'invite'
                  ? 'bg-blue-400/15 text-blue-400 border border-blue-400/30'
                  : 'bg-surface-overlay text-text-secondary hover:text-text-primary'
              }`}
            >
              Invite Player
            </button>
          </div>

          {mode === 'open' ? (
            <p className="text-xs text-text-muted">
              Anyone in the league can join your lobby.
            </p>
          ) : (
            <div className="space-y-2">
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search players..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-md bg-surface-overlay border border-border-default text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-400/50"
                  autoFocus
                />
              </div>

              {/* Player list */}
              <div className="max-h-48 overflow-y-auto space-y-1">
                {loading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-text-muted" />
                  </div>
                ) : filteredPlayers.length === 0 ? (
                  <div className="text-xs text-text-muted text-center py-3">
                    {search ? 'No players found.' : 'No other players available.'}
                  </div>
                ) : (
                  filteredPlayers.map(p => (
                    <button
                      key={p.username}
                      onClick={() => setSelectedInvitee(p.username)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedInvitee === p.username
                          ? 'bg-blue-400/15 text-blue-400'
                          : 'bg-surface-overlay text-text-primary hover:bg-surface-overlay/80'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.username}</span>
                        <span className="text-xs text-text-muted">{p.teamName}</span>
                      </div>
                      <span className="text-xs text-text-muted capitalize">{p.leagueId}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Format (fixed for now) */}
          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-surface-overlay">
            <span className="text-xs text-text-muted">Format</span>
            <span className="text-xs text-text-primary font-mono">[Gen 9] NatDex Draft</span>
          </div>

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={mode === 'invite' && !selectedInvitee}
            className="w-full px-4 py-2 rounded-md text-sm font-medium bg-blue-400/15 text-blue-400 hover:bg-blue-400/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mode === 'open' ? 'Create Open Lobby' : `Invite ${selectedInvitee ?? '...'}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Live Matches Section ─────────────────────────────────────────────────

function LiveMatchesSection({ matches, onSpectate }: {
  matches: LiveMatch[];
  onSpectate: (match: LiveMatch) => void;
}) {
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
