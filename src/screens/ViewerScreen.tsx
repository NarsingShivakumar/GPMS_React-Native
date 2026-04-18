// src/screens/ViewerScreen.tsx
import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder, GestureResponderEvent,
  TouchableOpacity, Animated, Dimensions, StatusBar, ActivityIndicator,
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

export default function ViewerScreen() {
  const route = useRoute<ViewerRoute>();
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();

  const { host, port, shareCode, deviceName } = route.params;
  const wsUrl = `ws://${host}:${port}`;

  const { latestFrameUri, remoteWidth, remoteHeight, fps } = useAppSelector(s => s.stream);
  const { latency, reconnectAttempts } = useAppSelector(s => s.connection);

  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsAnim = useRef(new Animated.Value(1)).current;
  const connBadgeAnim = useRef(new Animated.Value(0)).current;
  const frameLayout = useRef({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H });

  // ─── WebSocket (with connection-phase awareness) ───────────────────────────
  const { sendTouch, sendSwipe, sendKey, disconnect, wsStatus, connPhase } = useWebSocket({
    url: wsUrl,
    enabled: true,
    onConnect: () => {
      showConnectBadge();
      scheduleHideControls();
    },
    onDisconnect: () => {
      dispatch(setStatus('reconnecting'));
    },
    onPhaseChange: (phase) => {
      // Transition both devices out of loading screen only when
      // the full connecting_ack handshake completes (phase === 'ready').
      if (phase === 'ready') dispatch(setStatus('connected'));
    },
  });

  // true only after connecting_ack received — drives the loading overlay
  const isReady = connPhase === 'ready';

  // ─── Frame layout (scale remote coords) ────────────────────────────────────
  useEffect(() => {
    if (remoteWidth > 0 && remoteHeight > 0) {
      const aspect = remoteWidth / remoteHeight;
      let w = SCREEN_W;
      let h = SCREEN_W / aspect;
      if (h > SCREEN_H) { h = SCREEN_H; w = SCREEN_H * aspect; }
      frameLayout.current = {
        x: (SCREEN_W - w) / 2,
        y: (SCREEN_H - h) / 2,
        w,
        h,
      };
    }
  }, [remoteWidth, remoteHeight]);

  // ─── Animations ─────────────────────────────────────────────────────────────
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
      Animated.timing(controlsAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      setControlsVisible(false);
      dispatch(setShowControls(false));
    }, 4000);
  }, [dispatch]);

  const revealControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    Animated.timing(controlsAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setControlsVisible(true);
    dispatch(setShowControls(true));
    scheduleHideControls();
  }, [dispatch, scheduleHideControls]);

  useEffect(() => {
    scheduleHideControls();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      dispatch(resetStream());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Touch → coordinate scaling ────────────────────────────────────────────
  const scaleCoords = useCallback((tx: number, ty: number): [number, number] => {
    if (remoteWidth <= 0 || remoteHeight <= 0) return [tx, ty];
    const { x, y, w, h } = frameLayout.current;
    return [
      Math.max(0, Math.min(remoteWidth, (tx - x) * (remoteWidth / w))),
      Math.max(0, Math.min(remoteHeight, (ty - y) * (remoteHeight / h))),
    ];
  }, [remoteWidth, remoteHeight]);

  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,

    onPanResponderGrant: (e: GestureResponderEvent) => {
      revealControls();
      const { pageX, pageY } = e.nativeEvent;
      tapStartRef.current = { x: pageX, y: pageY, t: Date.now() };
      const [rx, ry] = scaleCoords(pageX, pageY);
      sendTouch('down', rx, ry);
    },

    onPanResponderMove: (e: GestureResponderEvent) => {
      // Forward live move events so long-press drags work correctly on host
      if (!tapStartRef.current) return;
      const [rx, ry] = scaleCoords(e.nativeEvent.pageX, e.nativeEvent.pageY);
      sendTouch('down', rx, ry);
    },

    onPanResponderRelease: (e: GestureResponderEvent, g) => {
      const start = tapStartRef.current;
      if (!start) return;
      const elapsed = Date.now() - start.t;
      const dist = Math.sqrt(g.dx * g.dx + g.dy * g.dy);

      if (dist < 8 && elapsed < 400) {
        const [rx, ry] = scaleCoords(e.nativeEvent.pageX, e.nativeEvent.pageY);
        sendTouch('tap', rx, ry, elapsed);
      } else if (dist > 20) {
        const [sx, sy] = scaleCoords(start.x, start.y);
        const [ex, ey] = scaleCoords(e.nativeEvent.pageX, e.nativeEvent.pageY);
        sendSwipe(sx, sy, ex, ey, Math.min(elapsed, 800));
      } else {
        const [rx, ry] = scaleCoords(e.nativeEvent.pageX, e.nativeEvent.pageY);
        sendTouch('up', rx, ry);
      }
      tapStartRef.current = null;
    },

    onPanResponderTerminate: () => {
      tapStartRef.current = null;
    },
  });

  // ─── Disconnect handler ────────────────────────────────────────────────────
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

  // ─── Loading overlay helpers ───────────────────────────────────────────────
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

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container} {...(isReady ? panResponder.panHandlers : {})}>
      <StatusBar hidden />

      {/* ── Loading overlay — shown until connecting_ack handshake completes ── */}
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

          {/* Allow cancel even from loading screen */}
          <TouchableOpacity style={styles.loadingDisconnect} onPress={handleDisconnect}>
            <Icon name="close-circle-outline" size={18} color={colors.textMuted} />
            <Text style={styles.loadingDisconnectText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Live stream frame ─────────────────────────────────────────────── */}
      {isReady && latestFrameUri ? (
        <FastImage
          style={styles.frame}
          source={{ uri: latestFrameUri, priority: FastImage.priority.high }}
          resizeMode={FastImage.resizeMode.contain}
        />
      ) : isReady ? (
        <View style={styles.waitingFrame}>
          <Icon name="monitor-shimmer" size={60} color={colors.textMuted} />
          <Text style={styles.waitingText}>Waiting for first frame…</Text>
          <View style={styles.reconnectDots}>
            {[0, 1, 2].map(i => (
              <DotBlink key={i} delay={i * 200} color={colors.primary} />
            ))}
          </View>
        </View>
      ) : null}

      {/* ── Top HUD (only when stream is live) ───────────────────────────── */}
      {isReady && (
        <Animated.View
          style={[
            styles.topHUD,
            { opacity: controlsAnim, pointerEvents: controlsVisible ? 'box-none' : 'none' },
          ]}>
          <LinearGradient
            colors={['rgba(5,13,31,0.9)', 'transparent']}
            style={styles.topGradient}>
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

      {/* ── Latency badge ────────────────────────────────────────────────── */}
      {isReady && wsStatus === 'connected' && latency > 0 && (
        <Animated.View
          style={[styles.statsOverlay, { opacity: controlsAnim, pointerEvents: 'none' }]}>
          <Text style={styles.statText}>{latency}ms</Text>
        </Animated.View>
      )}

      {/* ── Bottom control bar ───────────────────────────────────────────── */}
      {isReady && (
        <Animated.View
          style={[
            styles.bottomBar,
            { opacity: controlsAnim, paddingBottom: insets.bottom + 8 },
          ]}>
          <LinearGradient
            colors={['transparent', 'rgba(5,13,31,0.95)']}
            style={styles.bottomGradient}>
            <View style={styles.controlRow}>
              <ControlButton icon="arrow-left-circle" label="Back" onPress={() => sendKey('back')} />
              <ControlButton icon="circle-outline" label="Home" onPress={() => sendKey('home')} primary />
              <ControlButton icon="view-grid" label="Recents" onPress={() => sendKey('recents')} />
              <ControlButton icon="bell-outline" label="Notifs" onPress={() => sendKey('notifications')} />
            </View>
          </LinearGradient>
        </Animated.View>
      )}

      {/* ── Connected flash badge ─────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.connBadge,
          {
            opacity: connBadgeAnim,
            pointerEvents: 'none',
            transform: [{
              scale: connBadgeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.85, 1],
              }),
            }],
          },
        ]}>
        <LinearGradient
          colors={[`${colors.success}CC`, `${colors.success}88`]}
          style={styles.connBadgeInner}>
          <Icon name="access-point-check" size={20} color={palette.white} />
          <Text style={styles.connBadgeText}>Connected</Text>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function LoadingStep({
  done, active, label,
}: { done: boolean; active: boolean; label: string }) {
  return (
    <View style={lstyles.row}>
      {done ? (
        <Icon name="check-circle" size={16} color={colors.success} />
      ) : active ? (
        <ActivityIndicator size={14} color={colors.primary} />
      ) : (
        <Icon name="circle-outline" size={16} color={colors.textMuted} />
      )}
      <Text
        style={[
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: 3,
  },
  label: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
});

function ControlButton({
  icon, label, onPress, primary = false,
}: {
  icon: string; label: string; onPress: () => void; primary?: boolean;
}) {
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
        <View
          style={[
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
  }, []);
  return (
    <Animated.View
      style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: color, opacity: anim, margin: 3,
      }}
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Stream frame
  frame: { ...StyleSheet.absoluteFillObject },
  waitingFrame: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.base,
  },
  waitingText: { color: colors.textSecondary, fontSize: typography.base },

  // Loading overlay
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

  // Reconnect dots
  reconnectDots: {
    flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs,
  },

  // Top HUD
  topHUD: { position: 'absolute', top: 0, left: 0, right: 0 },
  topGradient: { paddingTop: 12, paddingBottom: 24 },
  topRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.base, gap: spacing.sm,
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

  // Latency badge
  statsOverlay: { position: 'absolute', top: 56, right: spacing.base },
  statText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'monospace' },

  // Bottom bar
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomGradient: { paddingTop: 32 },
  controlRow: {
    flexDirection: 'row', justifyContent: 'space-evenly',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  ctrlBtn: { alignItems: 'center', gap: 4 },
  ctrlIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctrlLabel: { color: colors.textMuted, fontSize: 10, fontWeight: typography.medium as any },

  // Connected flash badge
  connBadge: {
    position: 'absolute', top: '45%', alignSelf: 'center',
    borderRadius: radii.xl, overflow: 'hidden', ...shadows.successGlow,
  },
  connBadgeInner: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  connBadgeText: {
    color: palette.white,
    fontSize: typography.lg,
    fontWeight: typography.bold as any,
  },
});