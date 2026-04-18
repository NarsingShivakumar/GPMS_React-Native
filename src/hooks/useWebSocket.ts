// src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppDispatch } from '../store';
import {
  setStatus,
  setLatency,
  incrementReconnectAttempts,
  resetReconnectAttempts,
} from '../store/slices/connectionSlice';
import {
  setIsStreaming,
  setLatestFrame,
  setFps,
  setRemoteDevice,
  addBytes,
} from '../store/slices/streamSlice';

type WSStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

interface UseWebSocketOptions {
  url: string | null;
  enabled: boolean;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  maxReconnects?: number;
  reconnectIntervalMs?: number;
}

const MAX_RECONNECTS = 8;
const RECONNECT_BASE_MS = 1500;
const PING_INTERVAL_MS = 5000;

export function useWebSocket({
  url,
  enabled,
  onMessage,
  onConnect,
  onDisconnect,
  maxReconnects = MAX_RECONNECTS,
  reconnectIntervalMs = RECONNECT_BASE_MS,
}: UseWebSocketOptions) {
  const dispatch = useAppDispatch();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingTimeRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const [wsStatus, setWsStatus] = useState<WSStatus>('idle');

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (fpsTimerRef.current) {
      clearInterval(fpsTimerRef.current);
      fpsTimerRef.current = null;
    }
  }, []);

  const closeWS = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!url || !mountedRef.current) return;

    closeWS();
    const isReconnect = reconnectCountRef.current > 0;
    setWsStatus(isReconnect ? 'reconnecting' : 'connecting');
    dispatch(setStatus(isReconnect ? 'reconnecting' : 'connecting'));

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectCountRef.current = 0;
      dispatch(resetReconnectAttempts());
      setWsStatus('connected');
      dispatch(setStatus('connected'));
      dispatch(setIsStreaming(true));
      onConnect?.();

      // Start ping
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          pingTimeRef.current = Date.now();
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);

      // FPS meter
      fpsTimerRef.current = setInterval(() => {
        dispatch(setFps(frameCountRef.current));
        frameCountRef.current = 0;
      }, 1000);
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(e.data as string);
        handleMessage(msg);
        onMessage?.(msg);
      } catch (err) {
        // Non-JSON — ignore
      }
    };

    ws.onclose = (e) => {
      if (!mountedRef.current) return;
      clearTimers();
      dispatch(setIsStreaming(false));
      setWsStatus('closed');
      onDisconnect?.();

      if (enabled && reconnectCountRef.current < maxReconnects) {
        const backoff = Math.min(
          reconnectIntervalMs * Math.pow(1.5, reconnectCountRef.current),
          15000
        );
        reconnectCountRef.current += 1;
        dispatch(incrementReconnectAttempts());
        dispatch(setStatus('reconnecting'));
        reconnectTimerRef.current = setTimeout(connect, backoff);
      } else {
        dispatch(setStatus('disconnected'));
        setWsStatus('closed');
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setWsStatus('error');
    };
  }, [url, enabled, dispatch, closeWS, clearTimers, onConnect, onDisconnect, onMessage]);

  const handleMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'hello':
        dispatch(setRemoteDevice({
          width: msg.width,
          height: msg.height,
          deviceName: msg.deviceName || 'Remote Device',
        }));
        break;

      case 'frame':
        if (msg.data) {
          const uri = `data:image/jpeg;base64,${msg.data}`;
          dispatch(setLatestFrame(uri));
          frameCountRef.current += 1;
          const byteLen = (msg.data.length * 3) / 4;
          dispatch(addBytes(byteLen));
        }
        break;

      case 'pong':
        if (pingTimeRef.current > 0) {
          dispatch(setLatency(Date.now() - pingTimeRef.current));
          pingTimeRef.current = 0;
        }
        break;
    }
  }, [dispatch]);

  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const sendTouch = useCallback((
    action: 'tap' | 'down' | 'up',
    x: number,
    y: number,
    duration?: number
  ) => sendMessage({ type: 'touch', action, x, y, ...(duration ? { duration } : {}) }),
  [sendMessage]);

  const sendSwipe = useCallback((
    startX: number, startY: number,
    endX: number, endY: number,
    duration = 300
  ) => sendMessage({ type: 'swipe', startX, startY, endX, endY, duration }),
  [sendMessage]);

  const sendKey = useCallback((action: 'back' | 'home' | 'recents' | 'notifications') =>
    sendMessage({ type: 'key', action }),
  [sendMessage]);

  const disconnect = useCallback(() => {
    reconnectCountRef.current = maxReconnects; // Prevent auto-reconnect
    clearTimers();
    closeWS();
    dispatch(setIsStreaming(false));
    dispatch(setStatus('idle'));
    dispatch(resetReconnectAttempts());
    setWsStatus('closed');
  }, [clearTimers, closeWS, dispatch, maxReconnects]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled && url) {
      connect();
    }
    return () => {
      mountedRef.current = false;
      reconnectCountRef.current = maxReconnects;
      clearTimers();
      closeWS();
    };
  }, [url, enabled]);

  return {
    wsStatus,
    sendMessage,
    sendTouch,
    sendSwipe,
    sendKey,
    disconnect,
    isConnected: wsStatus === 'connected',
  };
}
