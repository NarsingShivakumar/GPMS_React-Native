// src/screens/ViewerScreen.tsx
import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder, GestureResponderEvent,
  TouchableOpacity, Animated, Dimensions, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FastImage from '@d11/react-native-fast-image';
// FIX: correct import
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

  const { sendTouch, sendSwipe, sendKey, disconnect, wsStatus } = useWebSocket({
    url: wsUrl,
    enabled: true,
    onConnect: () => {
      dispatch(setStatus('connected'));
      showConnectBadge();
      scheduleHideControls();
    },
    onDisconnect: () => { dispatch(setStatus('reconnecting')); },
  });

  useEffect(() => {
    if (remoteWidth > 0 && remoteHeight > 0) {
      const aspect = remoteWidth / remoteHeight;
      let w = SCREEN_W;
      let h = SCREEN_W / aspect;
      if (h > SCREEN_H) { h = SCREEN_H; w = SCREEN_H * aspect; }
      frameLayout.current = { x: (SCREEN_W - w) / 2, y: (SCREEN_H - h) / 2, w, h };
    }
  }, [remoteWidth, remoteHeight]);

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
  }, []);

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
    onPanResponderTerminate: () => { tapStartRef.current = null; },
  });

  const handleDisconnect = useCallback(() => {
    disconnect();
    dispatch(resetConnection());
    dispatch(resetStream());
    nav.goBack();
  }, [disconnect, dispatch, nav]);

  const statusColor = () => {
    switch (wsStatus) {
      case 'connected': return colors.success;
      case 'connecting': case 'reconnecting': return colors.warning;
      default: return colors.error;
    }
  };

  const statusLabel = () => {
    switch (wsStatus) {
      case 'connected': return `Connected • ${fps} fps`;
      case 'connecting': return 'Connecting…';
      case 'reconnecting': return `Reconnecting (${reconnectAttempts})…`;
      default: return 'Disconnected';
    }
  };

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <StatusBar hidden />

      {latestFrameUri ? (
        <FastImage
          style={styles.frame}
          source={{ uri: latestFrameUri, priority: FastImage.priority.high }}
          resizeMode={FastImage.resizeMode.contain}
        />
      ) : (
        <View style={styles.waitingFrame}>
          <Icon name="monitor-shimmer" size={60} color={colors.textMuted} />
          <Text style={styles.waitingText}>
            {wsStatus === 'connected' ? 'Waiting for stream…' : statusLabel()}
          </Text>
          {(wsStatus === 'connecting' || wsStatus === 'reconnecting') && (
            <View style={styles.reconnectDots}>
              {[0, 1, 2].map(i => <DotBlink key={i} delay={i * 200} color={colors.primary} />)}
            </View>
          )}
        </View>
      )}

      {/* Top HUD — FIX: pointerEvents moved into style object */}
      <Animated.View style={[styles.topHUD, { opacity: controlsAnim, pointerEvents: controlsVisible ? 'box-none' : 'none' }]}>
        <LinearGradient colors={['rgba(5,13,31,0.9)', 'transparent']} style={styles.topGradient}>
          <View style={styles.topRow}>
            <TouchableOpacity onPress={handleDisconnect} style={styles.hudBtn}>
              <Icon name="close" size={22} color={palette.white} />
            </TouchableOpacity>
            <View style={styles.deviceInfo}>
              <Icon name="monitor" size={14} color={colors.accent} />
              <Text style={styles.deviceName} numberOfLines={1}>{deviceName || host}</Text>
            </View>
            <View style={styles.statusPill}>
              <View style={[styles.statusDot, { backgroundColor: statusColor() }]} />
              <Text style={styles.statusPillText}>{statusLabel()}</Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      {wsStatus === 'connected' && latency > 0 && (
        <Animated.View style={[styles.statsOverlay, { opacity: controlsAnim, pointerEvents: 'none' }]}>
          <Text style={styles.statText}>{latency}ms</Text>
        </Animated.View>
      )}

      <Animated.View style={[styles.bottomBar, { opacity: controlsAnim, paddingBottom: insets.bottom + 8 }]}>
        <LinearGradient colors={['transparent', 'rgba(5,13,31,0.95)']} style={styles.bottomGradient}>
          <View style={styles.controlRow}>
            <ControlButton icon="arrow-left-circle" label="Back" onPress={() => sendKey('back')} />
            <ControlButton icon="circle-outline" label="Home" onPress={() => sendKey('home')} primary />
            <ControlButton icon="view-grid" label="Recents" onPress={() => sendKey('recents')} />
            <ControlButton icon="bell-outline" label="Notifs" onPress={() => sendKey('notifications')} />
          </View>
        </LinearGradient>
      </Animated.View>

      <Animated.View style={[styles.connBadge, {
        opacity: connBadgeAnim,
        pointerEvents: 'none',
        transform: [{ scale: connBadgeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
      }]}>
        <LinearGradient colors={[`${colors.success}CC`, `${colors.success}88`]} style={styles.connBadgeInner}>
          <Icon name="access-point-check" size={20} color={palette.white} />
          <Text style={styles.connBadgeText}>Connected</Text>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

function ControlButton({ icon, label, onPress, primary = false }: {
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
        <View style={[styles.ctrlIconWrap, primary && { backgroundColor: `${colors.primary}30`, borderColor: `${colors.primary}50` }]}>
          <Icon name={icon} size={primary ? 26 : 22} color={primary ? colors.primary : colors.textSecondary} />
        </View>
        <Text style={[styles.ctrlLabel, primary && { color: colors.primary }]}>{label}</Text>
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
  return <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: anim, margin: 3 }} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  frame: { ...StyleSheet.absoluteFillObject },
  waitingFrame: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.base },
  waitingText: { color: colors.textSecondary, fontSize: typography.base },
  reconnectDots: { flexDirection: 'row', alignItems: 'center' },
  topHUD: { position: 'absolute', top: 0, left: 0, right: 0 },
  topGradient: { paddingTop: 12, paddingBottom: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, gap: spacing.sm },
  hudBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  deviceInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  deviceName: { color: palette.white, fontSize: typography.sm, fontWeight: typography.semibold },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusPillText: { color: palette.white, fontSize: typography.xs, fontWeight: typography.medium },
  statsOverlay: { position: 'absolute', top: 56, right: spacing.base },
  statText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'monospace' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomGradient: { paddingTop: 32 },
  controlRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  ctrlBtn: { alignItems: 'center', gap: 4 },
  ctrlIconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  ctrlLabel: { color: colors.textMuted, fontSize: 10, fontWeight: typography.medium },
  connBadge: { position: 'absolute', top: '45%', alignSelf: 'center', borderRadius: radii.xl, overflow: 'hidden', ...shadows.successGlow },
  connBadgeInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  connBadgeText: { color: palette.white, fontSize: typography.lg, fontWeight: typography.bold },
});
