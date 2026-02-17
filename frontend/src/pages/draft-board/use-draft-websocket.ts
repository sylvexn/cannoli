/**
 * WebSocket hook for live draft connection.
 * Connects to /ws/draft/:leagueId, handles reconnection, and dispatches state updates.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { ApiDraftState } from '@/lib/api';

export interface DraftPresenceData {
  players: { teamId: string; username: string }[];
  spectators: { username: string; role: string }[];
}

export interface DraftWSMessage {
  type: 'draft_state' | 'pick_made' | 'presence' | 'error';
  data?: any;
  error?: string;
}

interface UseDraftWebSocketOptions {
  leagueId: string;
  enabled: boolean;
  onState: (state: ApiDraftState) => void;
  onPickMade: (data: { pick: { teamId: string; pokemonName: string; tier: number; pickNumber: number }; snapshot: ApiDraftState }) => void;
  onPresence: (data: DraftPresenceData) => void;
  onError: (error: string) => void;
}

export function useDraftWebSocket({
  leagueId,
  enabled,
  onState,
  onPickMade,
  onPresence,
  onError,
}: UseDraftWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);
  const pendingIdentifyRef = useRef<{ teamId: string | null; username: string; role: string } | null>(null);

  // Stable callback refs
  const onStateRef = useRef(onState);
  const onPickMadeRef = useRef(onPickMade);
  const onPresenceRef = useRef(onPresence);
  const onErrorRef = useRef(onError);
  onStateRef.current = onState;
  onPickMadeRef.current = onPickMade;
  onPresenceRef.current = onPresence;
  onErrorRef.current = onError;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/draft/${leagueId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      clearTimeout(reconnectTimerRef.current);
      // Send pending identify if we have one
      if (pendingIdentifyRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'identify', ...pendingIdentifyRef.current }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: DraftWSMessage = JSON.parse(event.data);
        switch (msg.type) {
          case 'draft_state':
            onStateRef.current(msg.data);
            break;
          case 'pick_made':
            onPickMadeRef.current(msg.data);
            break;
          case 'presence':
            onPresenceRef.current(msg.data);
            break;
          case 'error':
            onErrorRef.current(msg.error ?? 'Unknown error');
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect after 2 seconds
      if (enabled) {
        reconnectTimerRef.current = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [leagueId, enabled]);

  // Connect/disconnect based on enabled flag
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    }

    return () => {
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, connect]);

  // Send identity to server (call after connecting)
  const identify = useCallback((teamId: string | null, username: string, role: string) => {
    pendingIdentifyRef.current = { teamId, username, role };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'identify', teamId, username, role }));
    }
  }, []);

  // Send a pick via WebSocket
  const sendPick = useCallback((pokemonName: string, teamId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      onErrorRef.current('Not connected to draft server');
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'pick', pokemonName, teamId }));
  }, []);

  return { connected, sendPick, identify };
}
