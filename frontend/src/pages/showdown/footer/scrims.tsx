/**
 * ScrimsSection — list of open/in-progress scrim lobbies + create dialog.
 * Extracted from arena-tab.tsx for the Showdown footer.
 */
import { useEffect, useState } from 'react';
import { Users, Plus, Loader2, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ScrimLobby } from '../use-arena-websocket';

interface ArenaPlayer {
  username: string;
  teamName: string;
  teamAbbrev: string;
  leagueId: string;
}

interface Props {
  lobbies: ScrimLobby[];
  user: any;
  username: string | undefined;
  onCreateScrim: (format?: string, invitee?: string) => void;
  onJoinScrim: (id: string) => void;
  onLeaveScrim: (id: string) => void;
  onReadyScrim: (id: string) => void;
}

export function ScrimsSection({
  lobbies, user, username, onCreateScrim, onJoinScrim, onLeaveScrim, onReadyScrim,
}: Props) {
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
              {amReady ? 'Ready ✓' : 'Ready'}
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

          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-surface-overlay">
            <span className="text-xs text-text-muted">Format</span>
            <span className="text-xs text-text-primary font-mono">[Gen 9] NatDex Draft</span>
          </div>

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
