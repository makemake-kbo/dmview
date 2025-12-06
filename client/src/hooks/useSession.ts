import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSession, getWebSocketUrl } from '../lib/api';
import { extractSessionId } from '../lib/session';
import type { SessionState } from '../types';

type Status = 'idle' | 'loading' | 'ready' | 'error';
type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type StateMessage = {
  type: 'state';
  payload: SessionState;
};

export function useSession(sessionId?: string) {
  const normalizedSessionId = useMemo(() => extractSessionId(sessionId), [sessionId]);
  const [session, setSession] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!normalizedSessionId) {
      setSession(null);
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    fetchSession(normalizedSessionId)
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setStatus('ready');
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedSessionId]);

  useEffect(() => {
    if (!normalizedSessionId) {
      setConnectionState('idle');
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let stopped = false;

    const setupSocket = () => {
      if (stopped) return;
      try {
        const ws = new WebSocket(getWebSocketUrl(normalizedSessionId));
        wsRef.current = ws;
        setConnectionState('connecting');

        ws.onopen = () => {
          if (!stopped) {
            setConnectionState('open');
          }
        };

        ws.onmessage = (event) => {
          try {
            const message: StateMessage = JSON.parse(event.data);
            if (message.type === 'state') {
              setSession(message.payload);
            }
          } catch (err) {
            console.warn('Failed to parse websocket payload', err);
          }
        };

        ws.onerror = () => {
          if (!stopped) {
            setConnectionState('error');
          }
        };

        ws.onclose = () => {
          if (stopped) return;
          setConnectionState('closed');
          reconnectTimerRef.current = window.setTimeout(setupSocket, 1000);
        };
      } catch {
        setConnectionState('error');
        reconnectTimerRef.current = window.setTimeout(setupSocket, 1500);
      }
    };

    setupSocket();

    return () => {
      stopped = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [normalizedSessionId]);

  const refresh = async () => {
    if (!normalizedSessionId) return;
    const data = await fetchSession(normalizedSessionId);
    setSession(data);
  };

  return { session, status, connectionState, error, refresh, setSession };
}
