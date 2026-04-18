// src/hooks/useRemoteControl.ts
//
// Translates raw PanResponder pixel events on the viewer's FastImage
// into normalised (0..1) coordinates, then sends them over WebSocket.
//
// Normalisation formula:
//   normX = (touchX_in_view - viewLeft) / viewWidth
//   normY = (touchY_in_view - viewTop)  / viewHeight
//
// The host AccessibilityService multiplies back by its real screen size,
// so the tap lands at exactly the same logical position regardless of
// what device the controller is running on.

import { useRef, useCallback } from 'react';
import {
    PanResponder, GestureResponderEvent, PanResponderGestureState, LayoutRectangle,
} from 'react-native';

interface RemoteControlOptions {
    /** FastImage layout rect — obtained from onLayout */
    viewLayout: LayoutRectangle | null;
    /** Remote screen dimensions (from `hello` WebSocket message) */
    remoteWidth: number;
    remoteHeight: number;
    /** WebSocket send functions from useWebSocket */
    sendTouch: (action: 'tap' | 'down' | 'up', x: number, y: number, duration?: number) => boolean;
    sendSwipe: (sx: number, sy: number, ex: number, ey: number, duration?: number) => boolean;
    sendKey: (action: 'back' | 'home' | 'recents' | 'notifications' | 'lock') => boolean;
    sendMessage: (msg: object) => boolean;
    /** Whether the stream is live — disables gestures when loading */
    enabled: boolean;
}

interface TouchState {
    startX: number;
    startY: number;
    startTime: number;
    moved: boolean;
    longPressTimer: ReturnType<typeof setTimeout> | null;
}

const TAP_MAX_DURATION_MS = 250;
const TAP_MAX_MOVE_PX = 10;
const LONG_PRESS_MS = 600;
const MOVE_THROTTLE_MS = 16;   // ~60fps
const PINCH_THRESHOLD_PX = 30;

export function useRemoteControl({
    viewLayout, remoteWidth, remoteHeight,
    sendTouch, sendSwipe, sendKey, sendMessage, enabled,
}: RemoteControlOptions) {

    const touchState = useRef<TouchState | null>(null);
    const lastMoveTime = useRef(0);
    const pinchStartDistance = useRef<number | null>(null);

    // ── Coordinate mapping ─────────────────────────────────────────────────

    const toNorm = useCallback((px: number, py: number): [number, number] => {
        if (!viewLayout) return [0.5, 0.5];
        const nx = Math.max(0, Math.min(1, (px - viewLayout.x) / viewLayout.width));
        const ny = Math.max(0, Math.min(1, (py - viewLayout.y) / viewLayout.height));
        return [nx, ny];
    }, [viewLayout]);

    // ── Long press detection ───────────────────────────────────────────────

    const clearLongPress = useCallback(() => {
        if (touchState.current?.longPressTimer) {
            clearTimeout(touchState.current.longPressTimer);
            touchState.current.longPressTimer = null;
        }
    }, []);

    // ── PanResponder ───────────────────────────────────────────────────────

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => enabled,
            onStartShouldSetPanResponderCapture: () => enabled,
            onMoveShouldSetPanResponder: () => enabled,
            onMoveShouldSetPanResponderCapture: () => enabled,

            // ── Touch DOWN ───────────────────────────────────────────────────
            onPanResponderGrant: (evt: GestureResponderEvent) => {
                if (!enabled) return;
                const touches = evt.nativeEvent.touches;

                if (touches.length === 2) {
                    // Two-finger gesture starts — record initial pinch distance
                    const dx = touches[1].pageX - touches[0].pageX;
                    const dy = touches[1].pageY - touches[0].pageY;
                    pinchStartDistance.current = Math.sqrt(dx * dx + dy * dy);
                    clearLongPress();
                    return;
                }

                const { pageX, pageY } = evt.nativeEvent;
                const [nx, ny] = toNorm(pageX, pageY);
                const now = Date.now();

                touchState.current = {
                    startX: pageX, startY: pageY,
                    startTime: now, moved: false,
                    longPressTimer: setTimeout(() => {
                        // Still held after LONG_PRESS_MS → long press
                        sendMessage({ type: 'longpress', x: nx, y: ny });
                        touchState.current && (touchState.current.moved = true); // prevent tap on release
                    }, LONG_PRESS_MS),
                };
            },

            // ── Touch MOVE ───────────────────────────────────────────────────
            onPanResponderMove: (evt: GestureResponderEvent, gs: PanResponderGestureState) => {
                if (!enabled) return;
                const touches = evt.nativeEvent.touches;

                // ── Pinch / Zoom ──────────────────────────────────────────────
                if (touches.length === 2 && pinchStartDistance.current !== null) {
                    const dx = touches[1].pageX - touches[0].pageX;
                    const dy = touches[1].pageY - touches[0].pageY;
                    const currentDist = Math.sqrt(dx * dx + dy * dy);
                    const delta = Math.abs(currentDist - pinchStartDistance.current);

                    if (delta > PINCH_THRESHOLD_PX) {
                        const scale = currentDist / pinchStartDistance.current;
                        const cx = (touches[0].pageX + touches[1].pageX) / 2;
                        const cy = (touches[0].pageY + touches[1].pageY) / 2;
                        const [ncx, ncy] = toNorm(cx, cy);
                        sendMessage({ type: 'pinch', cx: ncx, cy: ncy, scale, duration: 400 });
                        pinchStartDistance.current = currentDist;  // rolling delta
                    }
                    return;
                }

                // ── Drag / Swipe move ────────────────────────────────────────
                const now = Date.now();
                if (now - lastMoveTime.current < MOVE_THROTTLE_MS) return;
                lastMoveTime.current = now;

                const state = touchState.current;
                if (!state) return;

                const dx = Math.abs(gs.dx);
                const dy = Math.abs(gs.dy);
                if (dx > TAP_MAX_MOVE_PX || dy > TAP_MAX_MOVE_PX) {
                    state.moved = true;
                    clearLongPress();
                    // Send real-time drag position as a touch move
                    const [nx, ny] = toNorm(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
                    sendTouch('down', nx, ny);
                }
            },

            // ── Touch UP ─────────────────────────────────────────────────────
            onPanResponderRelease: (evt: GestureResponderEvent, gs: PanResponderGestureState) => {
                if (!enabled) return;
                clearLongPress();
                pinchStartDistance.current = null;

                const state = touchState.current;
                touchState.current = null;

                if (!state) return;

                const duration = Date.now() - state.startTime;
                const moved = state.moved ||
                    Math.abs(gs.dx) > TAP_MAX_MOVE_PX ||
                    Math.abs(gs.dy) > TAP_MAX_MOVE_PX;

                if (!moved && duration < TAP_MAX_DURATION_MS) {
                    // Short, stationary release → tap
                    const [nx, ny] = toNorm(state.startX, state.startY);
                    sendTouch('tap', nx, ny, 50);
                } else if (moved) {
                    // Drag ended → send final swipe
                    const [sx, sy] = toNorm(state.startX, state.startY);
                    const [ex, ey] = toNorm(
                        state.startX + gs.dx,
                        state.startY + gs.dy,
                    );
                    sendSwipe(sx, sy, ex, ey, Math.max(100, Math.min(duration, 800)));
                }
            },

            onPanResponderTerminate: () => {
                clearLongPress();
                pinchStartDistance.current = null;
                touchState.current = null;
            },

            onShouldBlockNativeResponder: () => true,
        })
    ).current;

    return { panHandlers: panResponder.panHandlers, sendKey };
}