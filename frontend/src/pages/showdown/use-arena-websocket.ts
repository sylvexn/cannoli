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
  isCurrentWeek?: boolean; // true for the league's active-week fixture (and any playoff fixture)
  phase?: 'regular' | 'playoffs'; // present on official fixtures
  playoffRound?: string | null;   // 'qf' | 'sf' | 'f' for playoff fixtures
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
  /** Transient: set when a battle failed to start, cleared on the next update. */
  error?: string;
}

export interface LiveMatchStats {
  home: {
    player: string;
    pokemon: {
      species: string;
      kills: number;
      fainted: boolean;
      teraUsed: boolean;
      teraType: string | null;
      brought: boolean;
    }[];
  };
  away: {
    player: string;
    pokemon: {
      species: string;
      kills: number;
      fainted: boolean;
      teraUsed: boolean;
      teraType: string | null;
      brought: boolean;
    }[];
  };
  turn: number;
  terasRemaining: { home: boolean; away: boolean };
}

export interface ArenaState {
  /** Every playable fixture for the coach's team (any week), for the week picker. */
  myMatches: ArenaMatch[];
  liveMatches: LiveMatch[];
  scrimLobbies: ScrimLobby[];
  liveStats: LiveMatchStats | null;
  /** Spectator count keyed by matchId — updated via `spectator_count` events. */
  spectatorCounts: Record<string, number>;
  connected: boolean;
  /** Whether the Showdown monitor bot is connected. A match can only START
   *  (status → 'ready', battle created) while the bot is online; if offline,
   *  ready flags are kept and the match auto-resumes on reconnect. */
  botConnected: boolean;
  /** Latest match-error string surfaced by the server (e.g. "bot is offline").
   *  Cleared on the next successful match_state / match_live. */
  lastMatchError: string | null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useArenaWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Guard against setState / reconnect firing after the component unmounts.
  const mountedRef = useRef(true);

  const [state, setState] = useState<ArenaState>({
    myMatches: [],
    liveMatches: [],
    scrimLobbies: [],
    liveStats: null,
    spectatorCounts: {},
    connected: false,
    botConnected: false,
    lastMatchError: null,
  });

  // Seed (and re-seed on reconnect) the slices the WS only sends deltas for.
  // Without this, myMatches/liveMatches/scrimLobbies would stay empty until
  // something changed server-side.
  const refreshState = useCallback(() => {
    fetch('/api/arena/state', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!mountedRef.current) return;
        setState(s => ({
          ...s,
          myMatches: data.myMatches ?? [],
          liveMatches: data.liveMatches ?? [],
          scrimLobbies: data.scrimLobbies ?? [],
          botConnected: data.botConnected ?? false,
        }));
      })
      .catch(() => {});
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws/arena`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, connected: true }));
      // Auth happens via cookie on WS upgrade — no explicit identify needed.
      // Pull a fresh snapshot now that we're (re)connected.
      refreshState();
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'identified':
            // Successfully authenticated
            break;

          case 'match_state':
            setState(s => ({
              ...s,
              // A fresh state supersedes a stale error ONLY when the match moves
              // forward (ready / in_progress). The invite-failure path emits a
              // match_error and then reverts the match to 'scheduled' with a
              // trailing match_state — clearing here would wipe the "couldn't
              // start — try again (reason)" line before the coach ever sees it.
              lastMatchError: msg.status === 'scheduled' ? s.lastMatchError : null,
              myMatches: s.myMatches.map(m =>
                m.matchId === msg.matchId
                  ? {
                      ...m,
                      status: msg.status,
                      readyHome: msg.readyHome,
                      readyAway: msg.readyAway,
                      psRoomId: msg.psRoomId,
                    }
                  : m,
              ),
            }));
            break;

          case 'match_live':
            setState(s => ({
              ...s,
              lastMatchError: null,
              myMatches: s.myMatches.map(m =>
                m.matchId === msg.matchId
                  ? { ...m, status: 'in_progress', psRoomId: msg.psRoomId }
                  : m,
              ),
            }));
            break;

          case 'bot_status':
            setState(s => ({ ...s, botConnected: !!msg.connected }));
            break;

          case 'match_result':
            setState(s => ({
              ...s,
              myMatches: s.myMatches.map(m =>
                m.matchId === msg.matchId ? { ...m, status: 'completed' } : m,
              ),
            }));
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
                  ? { ...l, players: msg.players, ready: msg.ready, status: msg.status, error: undefined }
                  : l,
              ),
            }));
            break;

          case 'scrim_error':
            // Battle couldn't be created (bot offline / player not found on PS).
            // The lobby reverted to 'waiting' server-side; reflect that and show
            // the reason on the lobby so players know to try again.
            console.warn('[Arena WS] scrim_error', msg.message);
            setState(s => ({
              ...s,
              scrimLobbies: s.scrimLobbies.map(l =>
                l.id === msg.lobbyId
                  ? {
                      ...l,
                      players: msg.players ?? l.players,
                      ready: msg.ready ?? l.ready,
                      status: msg.status ?? 'waiting',
                      error: msg.message ?? 'Couldn\'t start battle — try again.',
                    }
                  : l,
              ),
            }));
            break;

          case 'arena_stats':
            setState(s => ({ ...s, liveStats: msg.stats }));
            break;

          case 'spectator_count':
            setState(s => ({
              ...s,
              spectatorCounts: { ...s.spectatorCounts, [msg.matchId]: msg.count },
            }));
            break;

          case 'match_error':
            console.warn('[Arena WS]', msg.message);
            setState(s => ({ ...s, lastMatchError: msg.message ?? null }));
            break;

          case 'match_timeout':
            // Team-selection window expired before both coaches picked a team.
            // Surface a clear, actionable message; the match itself reverts to
            // 'scheduled' server-side (delivered via a following match_state).
            console.warn('[Arena WS] match_timeout', msg.matchId);
            setState(s => ({
              ...s,
              lastMatchError: msg.message ?? 'Team selection timed out — ready up to try again.',
            }));
            break;

          case 'error':
            console.warn('[Arena WS]', msg.message);
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, connected: false }));
      wsRef.current = null;
      // Auto-reconnect after 2s — only while the component is still mounted.
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [refreshState]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      // Mark unmounted first so any in-flight onclose / onmessage / timers
      // that fire after this point do not call setState or schedule reconnects.
      mountedRef.current = false;
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

  const readyUp = useCallback((matchId: string) => send({ type: 'match_ready', matchId }), [send]);
  const unready = useCallback((matchId: string) => send({ type: 'match_unready', matchId }), [send]);

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
