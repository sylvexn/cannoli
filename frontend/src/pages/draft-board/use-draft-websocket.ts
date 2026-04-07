/**
 * WebSocket hook for live draft connection.
 * Connects to /ws/draft/:leagueId, handles reconnection, and dispatches state updates.
 *
 * Pick send flow:
 * 1. Caller calls sendPick(name, teamId) → returns a clientRequestId (uuid).
 * 2. We cache the request locally so a flaky reconnect can re-send with the
 *    same id (server dedupes; see backend draft.ts idempotency map).
 * 3. On 'pick_made' or 'error' for that requestId, the cache entry is dropped.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { ApiDraftState } from '@/lib/api';

export interface DraftPresenceData {
  players: { teamId: string; username: string }[];
  spectators: { username: string; role: string }[];
}

export interface DraftWSMessage {
  type: 'draft_state' | 'pick_made' | 'auto_pick' | 'timer_expired' | 'presence' | 'error';
  data?: any;
  error?: string;
  code?: string;
  clientRequestId?: string;
  idempotent?: boolean;
}

interface UseDraftWebSocketOptions {
  leagueId: string;
  enabled: boolean;
  onState: (state: ApiDraftState) => void;
  onPickMade: (
    data: { pick: { teamId: string; pokemonName: string; tier: number; pickNumber: number }; snapshot: ApiDraftState },
    meta?: { clientRequestId?: string; idempotent?: boolean },
  ) => void;
  onPresence: (data: DraftPresenceData) => void;
  onError: (error: string, meta?: { code?: string; clientRequestId?: string }) => void;
}

interface PendingPick {
  pokemonName: string;
  teamId: string;
  username: string;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const pendingIdentifyRef = useRef<{ teamId: string | null; username: string; role: string } | null>(null);
  // In-flight picks awaiting server confirmation; replayed verbatim on reconnect.
  const pendingPicksRef = useRef<Map<string, PendingPick>>(new Map());
  // Latest desired-enabled flag, used by onclose to decide whether to reconnect.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

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
      // Re-send any in-flight picks with their original clientRequestId. The
      // server dedupes via idempotency map, so this is safe even if the
      // original send made it through before the disconnect.
      for (const [reqId, pp] of pendingPicksRef.current) {
        ws.send(JSON.stringify({ type: 'pick', clientRequestId: reqId, ...pp }));
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
            // Drop in-flight cache for this request — server confirmed.
            if (msg.clientRequestId) pendingPicksRef.current.delete(msg.clientRequestId);
            onPickMadeRef.current(msg.data, { clientRequestId: msg.clientRequestId, idempotent: msg.idempotent });
            break;
          case 'auto_pick':
            // Admin-triggered auto-pick (the live scheduler now pauses on timer
            // expiry; admin explicitly resolves it). Backend includes the
            // post-pick snapshot so clients apply it via LIVE_SYNC without
            // racing the separate draft_state broadcast.
            onPickMadeRef.current(
              { pick: msg.data.pick, snapshot: msg.data.snapshot as ApiDraftState },
              { clientRequestId: undefined, idempotent: false },
            );
            break;
          case 'timer_expired':
            // Scheduler paused the draft on timer expiry. The accompanying
            // draft_state broadcast carries the new paused snapshot, so we
            // don't need to do anything here beyond surface it as info.
            break;
          case 'presence':
            onPresenceRef.current(msg.data);
            break;
          case 'error':
            // Drop in-flight on terminal errors so we don't replay forever.
            if (msg.clientRequestId) pendingPicksRef.current.delete(msg.clientRequestId);
            onErrorRef.current(msg.error ?? 'Unknown error', { code: msg.code, clientRequestId: msg.clientRequestId });
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (enabledRef.current) {
        reconnectTimerRef.current = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [leagueId]);

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
      // Drop in-flight picks when leaving live mode — they're not relevant anymore.
      pendingPicksRef.current.clear();
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

  /**
   * Send a pick over the WS, returning the clientRequestId so the caller can
   * correlate confirmations / errors. If the socket isn't open, the pick is
   * still queued and re-sent on reconnect (same request id → server dedupes).
   */
  const sendPick = useCallback((pokemonName: string, teamId: string, username = teamId): string => {
    const clientRequestId = uuid();
    const pending: PendingPick = { pokemonName, teamId, username };
    pendingPicksRef.current.set(clientRequestId, pending);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'pick', clientRequestId, ...pending }));
    } else {
      // Socket not open — onopen will replay from pendingPicksRef.
      onErrorRef.current('Reconnecting — your pick will be sent automatically', {
        code: 'pending_send', clientRequestId,
      });
    }
    return clientRequestId;
  }, []);

  return { connected, sendPick, identify };
}
