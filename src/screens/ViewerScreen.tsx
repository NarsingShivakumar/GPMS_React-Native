// src/screens/ViewerScreen.tsx
import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder, GestureResponderEvent,
  PanResponderGestureState, TouchableOpacity, Animated, Dimensions,
  StatusBar, ActivityIndicator, LayoutRectangle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FastImage from '@d11/react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useAppDispatch, useAppSelector } from '../store';
import { setShowControls, resetStream } from '../store/slices/streamSlice';
import { resetConnection, setStatus } from '../store/slices/connectionSlice';
import { useWebSocket } from '../hooks/useWebSocket';
import { colors, typography, spacing, radii, shadows, palette } from '../theme/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type ViewerRoute = RouteProp<RootStackParamList, 'Viewer'>;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Constants ────────────────────────────────────────────────────────────────
const TAP_MAX_MOVE_PX = 8;
const TAP_MAX_DURATION_MS = 350;
const LONG_PRESS_MS = 650;
const MOVE_THROTTLE_MS = 16;   // ~60 fps cap for drag events
const PINCH_MIN_DELTA_PX = 20;

export default function ViewerScreen() {
  const route = useRoute<ViewerRoute>();
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();

  const { host, port, shareCode, deviceName } = route.params;
  const wsUrl = `ws://${host}:${port}`;

  const { latestFrameUri, remoteWidth, remoteHeight, fps } =
    useAppSelector(s => s.stream);
  const { latency, reconnectAttempts } =
    useAppSelector(s => s.connection);

  // ─── UI state ──────────────────────────────────────────────────────────────
  const [controlsVisible, setControlsVisible] = useState(true);
  const [viewLayout, setViewLayout] = useState<LayoutRectangle | null>(null);

  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsAnim = useRef(new Animated.Value(1)).current;
  const connBadgeAnim = useRef(new Animated.Value(0)).current;

  // ─── Touch ripple ──────────────────────────────────────────────────────────
  const [ripplePos, setRipplePos] = useState<{ x: number; y: number } | null>(null);
  const rippleAnim = useRef(new Animated.Value(0)).current;

  const showRipple = useCallback((px: number, py: number) => {
    setRipplePos({ x: px, y: py });
    rippleAnim.setValue(1);
    Animated.timing(rippleAnim, {
      toValue: 0, duration: 400, useNativeDriver: true,
    }).start(() => setRipplePos(null));
  }, [rippleAnim]);

  // ─── Double-buffer state ───────────────────────────────────────────────────
  // Two FastImage slots (A and B) alternate as the "active" display slot.
  // The inactive slot loads the new frame off-screen; once onLoad fires we
  // flip activeSlot — the previous frame stays visible until the new one is
  // GPU-ready, completely eliminating the black flash between frames.
  const activeSlot = useRef<'A' | 'B'>('A');
  const [slotA, setSlotA] = useState<string | null>(null);
  const [slotB, setSlotB] = useState<string | null>(null);
  // pendingSlot tracks which slot is currently loading a new frame
  const pendingSlot = useRef<'A' | 'B' | null>(null);

  // Feed new frames into the inactive slot
  useEffect(() => {
    if (!latestFrameUri) return;
    if (activeSlot.current === 'A') {
      // Active is A → load into B
      pendingSlot.current = 'B';
      setSlotB(latestFrameUri);
    } else {
      // Active is B → load into A
      pendingSlot.current = 'A';
      setSlotA(latestFrameUri);
    }
  }, [latestFrameUri]);

  // Called by the inactive FastImage once its frame is fully decoded
  const handleFrameLoaded = useCallback((slot: 'A' | 'B') => {
    if (slot !== activeSlot.current && slot === pendingSlot.current) {
      // Swap: new slot becomes active, clear the old slot's URI to free memory
      const prev = activeSlot.current;
      activeSlot.current = slot;
      pendingSlot.current = null;
      if (prev === 'A') setSlotA(null);
      else setSlotB(null);
    }
  }, []);

  // ─── WebSocket ─────────────────────────────────────────────────────────────
  const {
    sendTouch, sendSwipe, sendKey, sendMessage,
    disconnect, wsStatus, connPhase,
  } = useWebSocket({
    url: wsUrl,
    enabled: true,
    onConnect: () => {
      showConnectBadge();
      scheduleHideControls();
    },
    onDisconnect: () => dispatch(setStatus('reconnecting')),
    onPhaseChange: (phase) => {
      if (phase === 'ready') dispatch(setStatus('connected'));
    },
  });

  const isReady = connPhase === 'ready';

  // ─── Coordinate mapping ────────────────────────────────────────────────────
  // Normalises controller screen coords (0..1) so the host can scale them
  // back to its own resolution — works across different screen sizes.
  const toNorm = useCallback((px: number, py: number): [number, number] => {
    if (!viewLayout || viewLayout.width === 0 || viewLayout.height === 0) {
      return [0.5, 0.5];
    }
    const nx = Math.max(0, Math.min(1, (px - viewLayout.x) / viewLayout.width));
    const ny = Math.max(0, Math.min(1, (py - viewLayout.y) / viewLayout.height));
    return [nx, ny];
  }, [viewLayout]);

  // ─── Gesture state refs ─────────────────────────────────────────────────────
  const tapStartRef = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMoveTimeRef = useRef(0);
  const pinchStartDistRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // ─── PanResponder ──────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({

      onStartShouldSetPanResponder: () => isReady,
      onStartShouldSetPanResponderCapture: () => isReady,
      onMoveShouldSetPanResponder: (_, g) =>
        isReady && (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3),
      onMoveShouldSetPanResponderCapture: (_, g) =>
        isReady && (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3),

      // ── TOUCH DOWN ───────────────────────────────────────────────────────
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        revealControls();
        const touches = evt.nativeEvent.touches;

        if (touches.length >= 2) {
          const dx = touches[1].pageX - touches[0].pageX;
          const dy = touches[1].pageY - touches[0].pageY;
          pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
          clearLongPress();
          return;
        }

        const { pageX, pageY } = evt.nativeEvent;
        isDraggingRef.current = false;
        tapStartRef.current = { x: pageX, y: pageY, t: Date.now(), moved: false };

        longPressTimerRef.current = setTimeout(() => {
          if (tapStartRef.current && !tapStartRef.current.moved) {
            tapStartRef.current.moved = true;
            const [nx, ny] = toNorm(pageX, pageY);
            sendMessage({ type: 'longpress', x: nx, y: ny });
            showRipple(pageX, pageY);
          }
        }, LONG_PRESS_MS);
      },

      // ── TOUCH MOVE ───────────────────────────────────────────────────────
      onPanResponderMove: (evt: GestureResponderEvent, gs: PanResponderGestureState) => {
        const touches = evt.nativeEvent.touches;

        // Pinch / zoom — two fingers
        if (touches.length >= 2 && pinchStartDistRef.current !== null) {
          const dx = touches[1].pageX - touches[0].pageX;
          const dy = touches[1].pageY - touches[0].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const delta = dist - pinchStartDistRef.current;

          if (Math.abs(delta) > PINCH_MIN_DELTA_PX) {
            const scale = dist / pinchStartDistRef.current;
            const cx = (touches[0].pageX + touches[1].pageX) / 2;
            const cy = (touches[0].pageY + touches[1].pageY) / 2;
            const [ncx, ncy] = toNorm(cx, cy);
            sendMessage({ type: 'pinch', cx: ncx, cy: ncy, scale, duration: 350 });
            pinchStartDistRef.current = dist;
          }
          return;
        }

        // Single-finger drag
        const state = tapStartRef.current;
        if (!state) return;

        const now = Date.now();
        if (now - lastMoveTimeRef.current < MOVE_THROTTLE_MS) return;
        lastMoveTimeRef.current = now;

        const totalMove = Math.sqrt(gs.dx * gs.dx + gs.dy * gs.dy);
        if (totalMove > TAP_MAX_MOVE_PX) {
          if (!state.moved) {
            state.moved = true;
            isDraggingRef.current = true;
            clearLongPress();
          }
          const [nx, ny] = toNorm(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
          sendTouch('down', nx, ny);
        }
      },

      // ── TOUCH UP ─────────────────────────────────────────────────────────
      onPanResponderRelease: (evt: GestureResponderEvent, gs: PanResponderGestureState) => {
        clearLongPress();
        pinchStartDistRef.current = null;

        const state = tapStartRef.current;
        tapStartRef.current = null;
        if (!state) return;

        const elapsed = Date.now() - state.t;
        const totalMove = Math.sqrt(gs.dx * gs.dx + gs.dy * gs.dy);
        const moved = state.moved || totalMove > TAP_MAX_MOVE_PX;

        if (!moved && elapsed < TAP_MAX_DURATION_MS) {
          // Tap
          const [nx, ny] = toNorm(state.x, state.y);
          sendTouch('tap', nx, ny, 50);
          showRipple(state.x, state.y);
        } else if (moved && isDraggingRef.current) {
          // Swipe / drag
          const [sx, sy] = toNorm(state.x, state.y);
          const [ex, ey] = toNorm(state.x + gs.dx, state.y + gs.dy);
          sendSwipe(sx, sy, ex, ey, Math.max(80, Math.min(elapsed, 800)));
        } else {
          // Long-press already fired — send lift
          const [nx, ny] = toNorm(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
          sendTouch('up', nx, ny);
        }

        isDraggingRef.current = false;
      },

      onPanResponderTerminate: () => {
        clearLongPress();
        pinchStartDistRef.current = null;
        tapStartRef.current = null;
        isDraggingRef.current = false;
      },

      onShouldBlockNativeResponder: () => true,
    })
  ).current;

  // ─── Controls visibility ───────────────────────────────────────────────────
  const showConnectBadge = () => {
    Animated.sequence([
      Animated.timing(connBadgeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(connBadgeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      Animated.timing(controlsAnim, {
        toValue: 0, duration: 300, useNativeDriver: true,
      }).start();
      setControlsVisible(false);
      dispatch(setShowControls(false));
    }, 4000);
  }, [dispatch, controlsAnim]);

  const revealControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    Animated.timing(controlsAnim, {
      toValue: 1, duration: 200, useNativeDriver: true,
    }).start();
    setControlsVisible(true);
    dispatch(setShowControls(true));
    scheduleHideControls();
  }, [dispatch, scheduleHideControls, controlsAnim]);

  useEffect(() => {
    scheduleHideControls();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      dispatch(resetStream());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Disconnect ─────────────────────────────────────────────────────────────
  const handleDisconnect = useCallback(() => {
    disconnect();
    dispatch(resetConnection());
    dispatch(resetStream());
    nav.goBack();
  }, [disconnect, dispatch, nav]);

  // ─── HUD helpers ────────────────────────────────────────────────────────────
  const statusColor = () => {
    if (!isReady) return colors.warning;
    switch (wsStatus) {
      case 'connected': return colors.success;
      case 'connecting':
      case 'reconnecting': return colors.warning;
      default: return colors.error;
    }
  };

  const statusLabel = () => {
    if (!isReady) {
      switch (connPhase) {
        case 'socket': return 'Connecting…';
        case 'hello': return 'Establishing stream…';
        default: return 'Starting…';
      }
    }
    switch (wsStatus) {
      case 'connected': return `Connected • ${fps} fps`;
      case 'connecting': return 'Connecting…';
      case 'reconnecting': return `Reconnecting (${reconnectAttempts})…`;
      default: return 'Disconnected';
    }
  };

  const loadingTitle = () => {
    switch (connPhase) {
      case 'socket': return 'Connecting…';
      case 'hello': return 'Establishing Stream…';
      case 'disconnected': return 'Reconnecting…';
      default: return 'Starting…';
    }
  };

  const loadingSubtitle = () => {
    if (connPhase === 'hello') return 'Host device is preparing screen share';
    if (connPhase === 'disconnected' || wsStatus === 'reconnecting')
      return `Attempt ${reconnectAttempts} of 8`;
    return `Connecting to ${deviceName || host}`;
  };

  // Whether either slot has content (stream has started)
  const hasFrame = slotA !== null || slotB !== null;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* ── Loading overlay — hidden only after connecting_ack ──────────────── */}
      {!isReady && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingTitle}>{loadingTitle()}</Text>
            <Text style={styles.loadingSubtitle}>{loadingSubtitle()}</Text>

            {(connPhase === 'disconnected' || wsStatus === 'reconnecting') && (
              <View style={styles.reconnectDots}>
                {[0, 1, 2].map(i => (
                  <DotBlink key={i} delay={i * 200} color={colors.primary} />
                ))}
              </View>
            )}

            {connPhase !== 'disconnected' && (
              <View style={styles.loadingSteps}>
                <LoadingStep
                  done={connPhase !== 'socket' && connPhase !== 'idle'}
                  active={connPhase === 'socket'}
                  label="WebSocket connected"
                />
                <LoadingStep
                  done={connPhase === 'ready'}
                  active={connPhase === 'hello'}
                  label="Screen dimensions received"
                />
                <LoadingStep
                  done={connPhase === 'ready'}
                  active={connPhase === 'hello'}
                  label="Stream ready"
                />
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.loadingDisconnect} onPress={handleDisconnect}>
            <Icon name="close-circle-outline" size={18} color={colors.textMuted} />
            <Text style={styles.loadingDisconnectText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Gesture + double-buffer stream layer ────────────────────────────── */}
      {isReady && (
        <View
          style={styles.gestureLayer}
          onLayout={(e) => setViewLayout(e.nativeEvent.layout)}
          {...panResponder.panHandlers}
        >

          {/* ── Double-buffer frames ────────────────────────────────────────
               Slot A and Slot B overlap absolutely.
               Only the ACTIVE slot is visible (opacity 1); the inactive
               slot loads the next frame at opacity 0 so Glide warms it on
               the GPU. When onLoad fires on the inactive slot we flip
               activeSlot — the previous frame stays on screen until the
               next one is truly ready, eliminating the black flash.        */}

          {slotA !== null && (
            <FastImage
              key="slotA"
              style={[
                styles.frame,
                activeSlot.current !== 'A' && styles.frameHidden,
              ]}
              source={{ uri: slotA, priority: FastImage.priority.high }}
              resizeMode={FastImage.resizeMode.contain}
              onLoad={() => handleFrameLoaded('A')}
              pointerEvents="none"
            />
          )}

          {slotB !== null && (
            <FastImage
              key="slotB"
              style={[
                styles.frame,
                activeSlot.current !== 'B' && styles.frameHidden,
              ]}
              source={{ uri: slotB, priority: FastImage.priority.high }}
              resizeMode={FastImage.resizeMode.contain}
              onLoad={() => handleFrameLoaded('B')}
              pointerEvents="none"
            />
          )}

          {/* Waiting state — shown when stream is live but no frame yet */}
          {!hasFrame && (
            <View style={styles.waitingFrame}>
              <Icon name="monitor-shimmer" size={60} color={colors.textMuted} />
              <Text style={styles.waitingText}>Waiting for first frame…</Text>
              <View style={styles.reconnectDots}>
                {[0, 1, 2].map(i => (
                  <DotBlink key={i} delay={i * 200} color={colors.primary} />
                ))}
              </View>
            </View>
          )}

          {/* Touch ripple — visual feedback for taps */}
          {ripplePos && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.touchRipple,
                {
                  left: ripplePos.x - 22,
                  top: ripplePos.y - 22,
                  opacity: rippleAnim,
                  transform: [{
                    scale: rippleAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1.8, 0.6],
                    }),
                  }],
                },
              ]}
            />
          )}
        </View>
      )}

      {/* ── Top HUD ─────────────────────────────────────────────────────────── */}
      {isReady && (
        <Animated.View
          pointerEvents={controlsVisible ? 'box-none' : 'none'}
          style={[styles.topHUD, { opacity: controlsAnim }]}
        >
          <LinearGradient
            colors={['rgba(5,13,31,0.92)', 'transparent']}
            style={styles.topGradient}
          >
            <View style={styles.topRow}>
              <TouchableOpacity onPress={handleDisconnect} style={styles.hudBtn}>
                <Icon name="close" size={22} color={palette.white} />
              </TouchableOpacity>

              <View style={styles.deviceInfo}>
                <Icon name="monitor" size={14} color={colors.accent} />
                <Text style={styles.deviceName} numberOfLines={1}>
                  {deviceName || host}
                </Text>
              </View>

              <View style={styles.statusPill}>
                <View style={[styles.statusDot, { backgroundColor: statusColor() }]} />
                <Text style={styles.statusPillText}>{statusLabel()}</Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>
      )}

      {/* ── Latency badge ────────────────────────────────────────────────────── */}
      {isReady && wsStatus === 'connected' && latency > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.statsOverlay, { opacity: controlsAnim }]}
        >
          <Text style={styles.statText}>{latency}ms</Text>
        </Animated.View>
      )}

      {/* ── Bottom system key bar ─────────────────────────────────────────────
           Sits OUTSIDE gestureLayer so taps here are not forwarded to host.
           Each button calls sendKey() directly.                              */}
      {isReady && (
        <Animated.View
          style={[
            styles.bottomBar,
            { opacity: controlsAnim, paddingBottom: insets.bottom + 8 },
          ]}
          pointerEvents={controlsVisible ? 'box-none' : 'none'}
        >
          <LinearGradient
            colors={['transparent', 'rgba(5,13,31,0.95)']}
            style={styles.bottomGradient}
          >
            <View style={styles.controlRow}>
              <ControlButton
                icon="view-grid"
                label="Recents"
                onPress={() => sendKey('recents')}
              />
              <ControlButton
                icon="circle-outline"
                label="Home"
                onPress={() => sendKey('home')}
                primary
              />
              <ControlButton
                icon="arrow-left-circle"
                label="Back"
                onPress={() => sendKey('back')}
              />
              <ControlButton
                icon="bell-outline"
                label="Notifs"
                onPress={() => sendKey('notifications')}
              />
            </View>
          </LinearGradient>
        </Animated.View>
      )}

      {/* ── Connected flash badge ─────────────────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.connBadge,
          {
            opacity: connBadgeAnim,
            transform: [{
              scale: connBadgeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.85, 1],
              }),
            }],
          },
        ]}
      >
        <LinearGradient
          colors={[`${colors.success}CC`, `${colors.success}88`]}
          style={styles.connBadgeInner}
        >
          <Icon name="access-point-check" size={20} color={palette.white} />
          <Text style={styles.connBadgeText}>Connected</Text>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingStep({
  done, active, label,
}: { done: boolean; active: boolean; label: string }) {
  return (
    <View style={lstyles.row}>
      {done
        ? <Icon name="check-circle" size={16} color={colors.success} />
        : active
          ? <ActivityIndicator size={14} color={colors.primary} />
          : <Icon name="circle-outline" size={16} color={colors.textMuted} />}
      <Text style={[
        lstyles.label,
        done && { color: colors.success },
        active && { color: palette.white },
      ]}>
        {label}
      </Text>
    </View>
  );
}

const lstyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: 3 },
  label: { fontSize: typography.sm, color: colors.textMuted },
});

function ControlButton({
  icon, label, onPress, primary = false,
}: { icon: string; label: string; onPress: () => void; primary?: boolean }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const press = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity onPress={press} style={styles.ctrlBtn} activeOpacity={0.85}>
        <View style={[
          styles.ctrlIconWrap,
          primary && {
            backgroundColor: `${colors.primary}30`,
            borderColor: `${colors.primary}50`,
          },
        ]}>
          <Icon
            name={icon}
            size={primary ? 26 : 22}
            color={primary ? colors.primary : colors.textSecondary}
          />
        </View>
        <Text style={[styles.ctrlLabel, primary && { color: colors.primary }]}>
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function DotBlink({ delay, color }: { delay: number; color: string }) {
  const anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={{
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: color, opacity: anim, margin: 3,
    }} />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // ── Gesture + stream layer ──────────────────────────────────────────────────
  gestureLayer: {
    ...StyleSheet.absoluteFillObject,
  },

  // Active frame — fully visible
  frame: {
    ...StyleSheet.absoluteFillObject,
  },

  // Inactive (loading) frame — invisible but still GPU-warm.
  // opacity:0 keeps it off-screen without triggering a Glide teardown.
  frameHidden: {
    opacity: 0,
  },

  waitingFrame: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.base,
  },
  waitingText: { color: colors.textSecondary, fontSize: typography.base },

  // ── Touch ripple ────────────────────────────────────────────────────────────
  touchRipple: {
    position: 'absolute',
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
  },

  // ── Loading overlay ─────────────────────────────────────────────────────────
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.navy,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    paddingHorizontal: spacing.xl,
  },
  loadingCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  loadingTitle: {
    color: palette.white,
    fontSize: typography.lg,
    fontWeight: typography.semibold as any,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  loadingSubtitle: {
    color: colors.textMuted,
    fontSize: typography.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.base,
  },
  loadingSteps: {
    width: '100%',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: 6,
  },
  loadingDisconnect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  loadingDisconnectText: { color: colors.textMuted, fontSize: typography.sm },

  reconnectDots: {
    flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs,
  },

  // ── Top HUD ─────────────────────────────────────────────────────────────────
  topHUD: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topGradient: { paddingTop: 12, paddingBottom: 24 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    gap: spacing.sm,
  },
  hudBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  deviceInfo: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    gap: spacing.xs, paddingHorizontal: spacing.sm,
  },
  deviceName: {
    color: palette.white,
    fontSize: typography.sm,
    fontWeight: typography.semibold as any,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radii.full,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusPillText: {
    color: palette.white,
    fontSize: typography.xs,
    fontWeight: typography.medium as any,
  },

  // ── Latency ──────────────────────────────────────────────────────────────────
  statsOverlay: { position: 'absolute', top: 56, right: spacing.base, zIndex: 10 },
  statText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'monospace' },

  // ── Bottom key bar ───────────────────────────────────────────────────────────
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 },
  bottomGradient: { paddingTop: 32 },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  ctrlBtn: { alignItems: 'center', gap: 4 },
  ctrlIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctrlLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: typography.medium as any,
  },

  // ── Connected flash badge ─────────────────────────────────────────────────────
  connBadge: {
    position: 'absolute', top: '45%', alignSelf: 'center',
    borderRadius: radii.xl, overflow: 'hidden', zIndex: 15,
    ...shadows.successGlow,
  },
  connBadgeInner: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  connBadgeText: {
    color: palette.white,
    fontSize: typography.lg,
    fontWeight: typography.bold as any,
  },
});