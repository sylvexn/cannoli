/**
 * WebSocket hook for Arena — match ready-up, scrim lobbies, live matches.
 * Connects to /ws/arena, auto-reconnects on disconnect.
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MatchTeam {
  id: string;
  name: string;
  abbrev: string;
  color: string;
}

export interface ArenaMatch {
  matchId: string;
  leagueId: string;
  week: number;
  status: 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'disputed';
  readyHome: boolean;
  readyAway: boolean;
  homeTeam: MatchTeam | null;
  awayTeam: MatchTeam | null;
  isHome?: boolean; // only set on "my match"
  psRoomId: string | null;
}

export interface LiveMatch {
  matchId: string;
  leagueId: string;
  week: number;
  homeTeam: { name: string; abbrev: string } | null;
  awayTeam: { name: string; abbrev: string } | null;
  psRoomId: string | null;
}

export interface ScrimLobby {
  id: string;
  format: string;
  creator: string;
  invitee: string | null;
  players: string[];
  ready: boolean[];
  status: 'waiting' | 'ready' | 'in_progress';
}

export interface ArenaState {
  myMatch: ArenaMatch | null;
  liveMatches: LiveMatch[];
  scrimLobbies: ScrimLobby[];
  connected: boolean;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useArenaWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [state, setState] = useState<ArenaState>({
    myMatch: null,
    liveMatches: [],
    scrimLobbies: [],
    connected: false,
  });

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws/arena`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, connected: true }));
      // Auth happens via cookie on WS upgrade — no explicit identify needed
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'identified':
            // Successfully authenticated
            break;

          case 'match_state':
            setState(s => {
              // Update myMatch if it's our match
              if (s.myMatch && s.myMatch.matchId === msg.matchId) {
                return {
                  ...s,
                  myMatch: {
                    ...s.myMatch,
                    status: msg.status,
                    readyHome: msg.readyHome,
                    readyAway: msg.readyAway,
                    psRoomId: msg.psRoomId,
                  },
                };
              }
              return s;
            });
            break;

          case 'match_live':
            setState(s => {
              if (s.myMatch && s.myMatch.matchId === msg.matchId) {
                return {
                  ...s,
                  myMatch: { ...s.myMatch, status: 'in_progress', psRoomId: msg.psRoomId },
                };
              }
              return s;
            });
            break;

          case 'match_result':
            setState(s => {
              if (s.myMatch && s.myMatch.matchId === msg.matchId) {
                return { ...s, myMatch: { ...s.myMatch, status: 'completed' } };
              }
              return s;
            });
            break;

          case 'live_matches':
            setState(s => ({ ...s, liveMatches: msg.matches }));
            break;

          case 'lobby_list':
            setState(s => ({ ...s, scrimLobbies: msg.lobbies }));
            break;

          case 'scrim_state':
            setState(s => ({
              ...s,
              scrimLobbies: s.scrimLobbies.map(l =>
                l.id === msg.lobbyId
                  ? { ...l, players: msg.players, ready: msg.ready, status: msg.status }
                  : l,
              ),
            }));
            break;

          case 'match_error':
          case 'error':
            console.warn('[Arena WS]', msg.message);
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setState(s => ({ ...s, connected: false }));
      wsRef.current = null;
      // Auto-reconnect after 2s
      reconnectTimerRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  // ─── Actions ────────────────────────────────────────────────────────

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const readyUp = useCallback(() => send({ type: 'match_ready' }), [send]);
  const unready = useCallback(() => send({ type: 'match_unready' }), [send]);

  const createScrim = useCallback((format?: string, invitee?: string) => {
    send({ type: 'scrim_create', format, invitee });
  }, [send]);

  const joinScrim = useCallback((lobbyId: string) => {
    send({ type: 'scrim_join', lobbyId });
  }, [send]);

  const leaveScrim = useCallback((lobbyId: string) => {
    send({ type: 'scrim_leave', lobbyId });
  }, [send]);

  const readyScrim = useCallback((lobbyId: string) => {
    send({ type: 'scrim_ready', lobbyId });
  }, [send]);

  const subscribeMatch = useCallback((matchId: string) => {
    send({ type: 'arena_subscribe', matchId });
  }, [send]);

  return {
    ...state,
    readyUp,
    unready,
    createScrim,
    joinScrim,
    leaveScrim,
    readyScrim,
    subscribeMatch,
  };
}
