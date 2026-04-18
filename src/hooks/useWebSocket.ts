// src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppDispatch } from '../store';
import {
  setStatus, setLatency,
  incrementReconnectAttempts, resetReconnectAttempts,
} from '../store/slices/connectionSlice';
import {
  setIsStreaming, setLatestFrame, setFps, setRemoteDevice, addBytes,
} from '../store/slices/streamSlice';

export type WSStatus =
  | 'idle' | 'connecting' | 'connected'
  | 'reconnecting' | 'closed' | 'error';

/** Extra state exposed to UI for the two-phase loading screen */
export type ConnectionPhase =
  | 'idle'           // not started
  | 'socket'         // TCP/WS handshake in progress
  | 'hello'          // received hello (dimensions), waiting for connecting_ack
  | 'ready'          // connecting_ack received — stream is active
  | 'disconnected';

interface UseWebSocketOptions {
  url: string | null;
  enabled: boolean;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onPhaseChange?: (phase: ConnectionPhase) => void;
  maxReconnects?: number;
  reconnectIntervalMs?: number;
}

const MAX_RECONNECTS = 8;
const RECONNECT_BASE_MS = 1500;
const PING_INTERVAL_MS = 5_000;

export function useWebSocket({
  url, enabled,
  onMessage, onConnect, onDisconnect, onPhaseChange,
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
  const [connPhase, setConnPhase] = useState<ConnectionPhase>('idle');

  const setPhase = useCallback((p: ConnectionPhase) => {
    setConnPhase(p);
    onPhaseChange?.(p);
  }, [onPhaseChange]);

  // ── timer helpers ────────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
    if (fpsTimerRef.current) { clearInterval(fpsTimerRef.current); fpsTimerRef.current = null; }
  }, []);

  const closeWS = useCallback(() => {
    if (wsRef.current) {
      const ws = wsRef.current;
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    }
  }, []);

  // ── message handler ──────────────────────────────────────────────────────

  const handleMessage = useCallback((msg: any) => {
    switch (msg.type) {

      case 'hello':
        // Server sent screen dimensions — update store then send "ready"
        dispatch(setRemoteDevice({
          width: msg.width,
          height: msg.height,
          deviceName: msg.deviceName || 'Remote Device',
        }));
        setPhase('hello');
        // Tell server we received hello and are ready
        wsRef.current?.send(JSON.stringify({ type: 'ready' }));
        break;

      case 'connecting_ack':
        // Server confirmed — loading phase is done, stream will begin
        setPhase('ready');
        dispatch(setStatus('connected'));
        dispatch(setIsStreaming(true));
        onConnect?.();
        break;

      case 'frame':
        if (msg.data) {
          dispatch(setLatestFrame(`data:image/jpeg;base64,${msg.data}`));
          frameCountRef.current += 1;
          dispatch(addBytes(Math.round((msg.data.length * 3) / 4)));
        }
        break;

      case 'pong':
        if (pingTimeRef.current > 0) {
          dispatch(setLatency(Date.now() - pingTimeRef.current));
          pingTimeRef.current = 0;
        }
        break;

      // Server health-check ping — reply so server knows we're alive
      case 'server_ping':
        wsRef.current?.send(JSON.stringify({ type: 'client_pong', ts: msg.ts }));
        break;
    }
  }, [dispatch, onConnect, setPhase]);

  // ── connect ──────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!url || !mountedRef.current) return;

    closeWS();
    const isReconnect = reconnectCountRef.current > 0;
    const status = isReconnect ? 'reconnecting' : 'connecting';
    setWsStatus(status);
    dispatch(setStatus(status));
    setPhase('socket');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectCountRef.current = 0;
      dispatch(resetReconnectAttempts());
      setWsStatus('connected');
      // Note: we do NOT dispatch setStatus('connected') here yet —
      // we wait for connecting_ack so both devices finish loading simultaneously.

      // Start client-side ping loop
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          pingTimeRef.current = Date.now();
          ws.send(JSON.stringify({ type: 'ping', ts: pingTimeRef.current }));
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
      } catch (_) { /* non-JSON — ignore */ }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      clearTimers();
      dispatch(setIsStreaming(false));
      setWsStatus('closed');
      setPhase('disconnected');
      onDisconnect?.();

      if (enabled && reconnectCountRef.current < maxReconnects) {
        const backoff = Math.min(
          reconnectIntervalMs * Math.pow(1.5, reconnectCountRef.current),
          15_000
        );
        reconnectCountRef.current += 1;
        dispatch(incrementReconnectAttempts());
        dispatch(setStatus('reconnecting'));
        reconnectTimerRef.current = setTimeout(connect, backoff);
      } else {
        dispatch(setStatus('disconnected'));
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setWsStatus('error');
    };
  }, [url, enabled, dispatch, closeWS, clearTimers, handleMessage,
    onConnect, onDisconnect, onMessage, setPhase,
    maxReconnects, reconnectIntervalMs]);

  // ── send helpers ─────────────────────────────────────────────────────────

  const sendMessage = useCallback((msg: object): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const sendTouch = useCallback(
    (action: 'tap' | 'down' | 'up', x: number, y: number, duration?: number) =>
      sendMessage({ type: 'touch', action, x, y, ...(duration ? { duration } : {}) }),
    [sendMessage]);

  const sendSwipe = useCallback(
    (startX: number, startY: number, endX: number, endY: number, duration = 300) =>
      sendMessage({ type: 'swipe', startX, startY, endX, endY, duration }),
    [sendMessage]);

  const sendKey = useCallback(
    (action: 'back' | 'home' | 'recents' | 'notifications') =>
      sendMessage({ type: 'key', action }),
    [sendMessage]);

  const disconnect = useCallback(() => {
    reconnectCountRef.current = maxReconnects;
    clearTimers();
    closeWS();
    dispatch(setIsStreaming(false));
    dispatch(setStatus('idle'));
    dispatch(resetReconnectAttempts());
    setWsStatus('closed');
    setPhase('idle');
  }, [clearTimers, closeWS, dispatch, maxReconnects, setPhase]);

  // ── effect ───────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    if (enabled && url) connect();
    return () => {
      mountedRef.current = false;
      reconnectCountRef.current = maxReconnects;
      clearTimers();
      closeWS();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled]);

  return {
    wsStatus, connPhase,
    sendMessage, sendTouch, sendSwipe, sendKey, disconnect,
    isConnected: connPhase === 'ready',
  };
}