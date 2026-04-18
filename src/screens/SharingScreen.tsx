// src/screens/SharingScreen.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  ScrollView, Alert, ActivityIndicator, Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useAppDispatch, useAppSelector } from '../store';
import {
  setConnectionInfo, setStatus, incrementClientCount,
  decrementClientCount, resetConnection,
} from '../store/slices/connectionSlice';
import { resetStream } from '../store/slices/streamSlice';
import { setRole } from '../store/slices/appSlice';
import { MirrorModule } from '../native/MirrorModule';
import { NSDModule } from '../native/NSDModule';
import { colors, typography, spacing, radii, shadows, palette } from '../theme/theme';

// idle         → user sees start button
// requesting   → MediaProjection permission dialog shown
// advertising  → server running, QR + share code visible, waiting for viewer
// establishing → viewer TCP-connected (hello sent), waiting for connecting_ack
// connected    → connecting_ack received, stream is live on both devices
// error        → any startup failure
type SharingPhase =
  | 'idle'
  | 'requesting'
  | 'advertising'
  | 'establishing'
  | 'connected'
  | 'error';

export default function SharingScreen() {
  const nav = useNavigation<any>();
  const dispatch = useAppDispatch();
  const { connectionInfo, clientCount } = useAppSelector(s => s.connection);
  const { accessibilityEnabled } = useAppSelector(s => s.app);

  const [phase, setPhase] = useState<SharingPhase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showQR, setShowQR] = useState(true);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const estabAnim = useRef(new Animated.Value(0)).current; // establishing overlay fade
  const evtSubsRef = useRef<any[]>([]);

  // ── Pulse animation on 'connected' ──────────────────────────────────────
  useEffect(() => {
    if (phase === 'connected') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [phase]);

  // ── Establishing overlay fade-in/out ────────────────────────────────────
  useEffect(() => {
    if (phase === 'establishing') {
      Animated.timing(estabAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } else {
      estabAnim.setValue(0);
    }
  }, [phase]);

  // ── Screen fade-in + native event listeners ─────────────────────────────
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();

    // onClientConnected fires the moment the viewer's WebSocket opens (hello sent).
    // → phase 'establishing' — loading screen shown on BOTH devices simultaneously.
    const subConnected = MirrorModule.addListener('onClientConnected', (_ip: string) => {
      dispatch(incrementClientCount());
      setPhase('establishing');   // ← was 'connected' directly; now waits for ack
      Vibration.vibrate(80);
    });

    const subDisconnected = MirrorModule.addListener('onClientDisconnected', (_: string) => {
      dispatch(decrementClientCount());
    });

    // onClientAcknowledged fires when StreamingServer sends connecting_ack
    // (i.e., client sent 'ready'). Both devices exit the loading screen here.
    const subAcknowledged = MirrorModule.addListener('onClientAcknowledged', (_: string) => {
      setPhase('connected');
      dispatch(setStatus('connected'));
    });

    if (subConnected) evtSubsRef.current.push(subConnected);
    if (subDisconnected) evtSubsRef.current.push(subDisconnected);
    if (subAcknowledged) evtSubsRef.current.push(subAcknowledged);

    return () => {
      evtSubsRef.current.forEach(s => s?.remove());
    };
  }, []);

  // ── Start sharing ────────────────────────────────────────────────────────
  const startSharing = useCallback(async () => {
    setPhase('requesting');
    setErrorMsg('');
    try {
      const result = await MirrorModule.startScreenCapture();
      dispatch(setConnectionInfo({
        shareCode: result.shareCode,
        ipAddress: result.ipAddress,
        port: result.port,
        qrData: result.qrData,
        connectionString: result.connectionString,
      }));
      dispatch(setStatus('advertising'));
      setPhase('advertising');
      await NSDModule.registerService(result.shareCode, result.port, result.shareCode);
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(e?.message || 'Failed to start screen capture');
    }
  }, [dispatch]);

  // ── Stop sharing ─────────────────────────────────────────────────────────
  const stopSharing = useCallback(async () => {
    Alert.alert(
      'Stop Sharing?',
      'This will disconnect all viewers and stop screen broadcasting.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop Sharing', style: 'destructive',
          onPress: async () => {
            await MirrorModule.stopScreenCapture();
            await NSDModule.unregisterService();
            dispatch(resetConnection());
            dispatch(resetStream());
            dispatch(setRole('none'));
            setPhase('idle');
            nav.navigate('Home');
          },
        },
      ]
    );
  }, [dispatch, nav]);

  // ── Phase renderers ───────────────────────────────────────────────────────

  const renderIdle = () => (
    <View style={styles.centerBlock}>
      <View style={styles.iconCircle}>
        <Icon name="cast" size={44} color={colors.primary} />
      </View>
      <Text style={styles.sectionTitle}>Start Screen Sharing</Text>
      <Text style={styles.sectionSubtitle}>
        Your screen will be broadcast to viewers on the same WiFi network
      </Text>
      {!accessibilityEnabled && (
        <TouchableOpacity
          style={styles.a11yBanner}
          onPress={() => MirrorModule.openAccessibilitySettings()}>
          <Icon name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={styles.a11yText}>Enable Accessibility Service for remote control</Text>
          <Icon name="chevron-right" size={18} color={colors.warning} />
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.startBtn} onPress={startSharing} activeOpacity={0.85}>
        <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.startBtnGradient}>
          <Icon name="cast" size={22} color={palette.white} />
          <Text style={styles.startBtnText}>Start Broadcasting</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );

  const renderRequesting = () => (
    <View style={styles.centerBlock}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.sectionTitle}>Requesting Permission</Text>
      <Text style={styles.sectionSubtitle}>
        Approve the screen capture request to begin sharing
      </Text>
    </View>
  );

  const renderAdvertising = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}>

      <View style={styles.statusRow}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>Broadcasting • Waiting for viewer</Text>
      </View>

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>SHARE CODE</Text>
        <Text style={styles.codeValue}>{connectionInfo?.shareCode}</Text>
        <Text style={styles.codeHint}>Share this code with the Control Device</Text>
      </View>

      <TouchableOpacity
        style={styles.qrToggle}
        onPress={() => setShowQR(v => !v)}
        activeOpacity={0.8}>
        <Icon
          name={showQR ? 'qrcode-minus' : 'qrcode-scan'}
          size={18}
          color={colors.accent}
        />
        <Text style={styles.qrToggleText}>
          {showQR ? 'Hide QR Code' : 'Show QR Code'}
        </Text>
      </TouchableOpacity>

      {showQR && connectionInfo?.qrData && (
        <View style={styles.qrContainer}>
          <View style={styles.qrFrame}>
            <View style={styles.qrCorner} />
            <View style={[styles.qrCorner, styles.qrCornerTR]} />
            <View style={[styles.qrCorner, styles.qrCornerBL]} />
            <View style={[styles.qrCorner, styles.qrCornerBR]} />
            <QRCode
              value={connectionInfo.qrData}
              size={180}
              backgroundColor="transparent"
              color={palette.white}
              quietZone={12}
            />
          </View>
          <Text style={styles.qrCaption}>Scan with Control Device</Text>
        </View>
      )}

      <View style={styles.infoCard}>
        <InfoRow icon="ip-network" label="IP Address" value={connectionInfo?.ipAddress ?? '—'} />
        <InfoRow icon="router-wireless" label="Port" value={String(connectionInfo?.port ?? '—')} />
        <InfoRow icon="link-variant" label="Connection String" value={connectionInfo?.connectionString ?? '—'} mono />
      </View>

      <TouchableOpacity style={styles.stopBtnOutline} onPress={stopSharing}>
        <Icon name="stop-circle-outline" size={20} color={colors.error} />
        <Text style={styles.stopBtnText}>Stop Sharing</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  // ── NEW: 'establishing' phase ─────────────────────────────────────────────
  // Shown after TCP connect (hello sent) but before connecting_ack is received.
  // Mirrors the loading screen the viewer sees simultaneously.
  const renderEstablishing = () => (
    <Animated.View style={[styles.establishingOverlay, { opacity: estabAnim }]}>
      <View style={styles.establishingCard}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.establishingTitle}>Establishing Connection…</Text>
        <Text style={styles.establishingSubtitle}>
          Viewer is connecting — setting up screen stream
        </Text>

        <View style={styles.estabSteps}>
          <EstabStep done label="Viewer TCP connected" />
          <EstabStep done={false} active label="Exchanging screen dimensions" />
          <EstabStep done={false} active={false} label="Stream acknowledged" />
        </View>

        <View style={styles.estabCodeRow}>
          <Text style={styles.estabCodeLabel}>SESSION</Text>
          <Text style={styles.estabCodeValue}>{connectionInfo?.shareCode}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.loadingDisconnect} onPress={stopSharing}>
        <Icon name="close-circle-outline" size={18} color={colors.textMuted} />
        <Text style={styles.loadingDisconnectText}>Stop Sharing</Text>
      </TouchableOpacity>
    </Animated.View>
  );

  const renderConnected = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}>

      <Animated.View style={[styles.connectedBadge, { transform: [{ scale: pulseAnim }] }]}>
        <LinearGradient
          colors={[`${colors.success}20`, `${colors.success}08`]}
          style={styles.connectedBadgeInner}>
          <Icon name="access-point-check" size={36} color={colors.success} />
          <Text style={styles.connectedText}>Viewer Connected</Text>
          <Text style={styles.connectedCount}>
            {clientCount} device{clientCount !== 1 ? 's' : ''}
          </Text>
        </LinearGradient>
      </Animated.View>

      {/* Stream live badge */}
      <View style={styles.streamLiveRow}>
        <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
        <Text style={[styles.statusText, { color: colors.success }]}>Screen stream live</Text>
        <View style={styles.liveTag}>
          <Text style={styles.liveTagText}>LIVE</Text>
        </View>
      </View>

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>SHARE CODE</Text>
        <Text style={styles.codeValue}>{connectionInfo?.shareCode}</Text>
      </View>

      <View style={styles.infoCard}>
        <InfoRow icon="ip-network" label="IP Address" value={connectionInfo?.ipAddress ?? '—'} />
        <InfoRow icon="account-multiple" label="Connected Viewers" value={String(clientCount)} />
        <InfoRow icon="cast-connected" label="Stream Status" value="Active" />
      </View>

      {!accessibilityEnabled && (
        <TouchableOpacity
          style={styles.a11yBanner}
          onPress={() => MirrorModule.openAccessibilitySettings()}>
          <Icon name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={styles.a11yText}>
            Enable Accessibility Service to allow remote touch control
          </Text>
          <Icon name="chevron-right" size={18} color={colors.warning} />
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.stopBtnOutline} onPress={stopSharing}>
        <Icon name="stop-circle-outline" size={20} color={colors.error} />
        <Text style={styles.stopBtnText}>Stop Sharing</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderError = () => (
    <View style={styles.centerBlock}>
      <View style={[styles.iconCircle, { backgroundColor: `${colors.error}20` }]}>
        <Icon name="alert-circle-outline" size={44} color={colors.error} />
      </View>
      <Text style={[styles.sectionTitle, { color: colors.error }]}>Failed to Start</Text>
      <Text style={styles.sectionSubtitle}>{errorMsg}</Text>
      <TouchableOpacity style={styles.startBtn} onPress={() => setPhase('idle')}>
        <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.startBtnGradient}>
          <Text style={styles.startBtnText}>Try Again</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );

  // ── Root render ──────────────────────────────────────────────────────────
  return (
    <LinearGradient colors={[palette.navy, palette.navyMid]} style={styles.bg}>
      <SafeAreaView style={styles.safe}>
        <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim }]}>

          <View style={styles.header}>
            <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn}>
              <Icon name="arrow-left" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Share Screen</Text>
            <View style={{ width: 40 }} />
          </View>

          {phase === 'idle' && renderIdle()}
          {phase === 'requesting' && renderRequesting()}
          {phase === 'advertising' && renderAdvertising()}
          {phase === 'establishing' && renderEstablishing()}
          {phase === 'connected' && renderConnected()}
          {phase === 'error' && renderError()}

        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ─── EstabStep ────────────────────────────────────────────────────────────────

function EstabStep({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <View style={estabStyles.row}>
      {done ? (
        <Icon name="check-circle" size={16} color={colors.success} />
      ) : active ? (
        <ActivityIndicator size={14} color={colors.primary} />
      ) : (
        <Icon name="circle-outline" size={16} color={colors.textMuted} />
      )}
      <Text style={[
        estabStyles.label,
        done && { color: colors.success },
        active && { color: palette.white },
      ]}>
        {label}
      </Text>
    </View>
  );
}

const estabStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: 3 },
  label: { fontSize: typography.sm, color: colors.textMuted },
});

// ─── InfoRow ─────────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value, mono = false }: {
  icon: string; label: string; value: string; mono?: boolean;
}) {
  return (
    <View style={infoStyles.row}>
      <Icon name={icon} size={16} color={colors.primary} style={{ marginRight: spacing.sm }} />
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={[infoStyles.value, mono && infoStyles.mono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  label: { color: colors.textSecondary, fontSize: typography.sm, flex: 1 },
  value: {
    color: colors.textPrimary, fontSize: typography.sm,
    fontWeight: typography.medium as any, maxWidth: '55%',
  },
  mono: { fontFamily: 'monospace', color: colors.accent, fontSize: typography.xs },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1 },
  safe: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.sm, backgroundColor: colors.bgLight,
  },
  headerTitle: { fontSize: typography.lg, fontWeight: typography.bold as any, color: colors.textPrimary },

  scrollContent: { padding: spacing.base, paddingBottom: spacing['4xl'] },
  centerBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  iconCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: `${colors.primary}18`,
    borderWidth: 1, borderColor: `${colors.primary}30`,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography['2xl'], fontWeight: typography.bold as any,
    color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm,
  },
  sectionSubtitle: {
    fontSize: typography.base, color: colors.textSecondary,
    textAlign: 'center', lineHeight: typography.base * 1.6, marginBottom: spacing.xl,
  },
  a11yBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: `${colors.warning}15`,
    borderWidth: 1, borderColor: `${colors.warning}40`,
    borderRadius: radii.md, padding: spacing.sm, paddingHorizontal: spacing.base,
    gap: spacing.sm, marginBottom: spacing.lg, width: '100%',
  },
  a11yText: { flex: 1, color: colors.warning, fontSize: typography.sm },

  startBtn: { width: '100%', borderRadius: radii.lg, overflow: 'hidden', ...shadows.glow },
  startBtnGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md + 2, gap: spacing.sm,
  },
  startBtnText: { color: palette.white, fontSize: typography.md, fontWeight: typography.bold as any },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.base },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  statusText: { color: colors.success, fontSize: typography.sm, fontWeight: typography.semibold as any },

  codeCard: {
    backgroundColor: colors.bgCard, borderRadius: radii.xl,
    borderWidth: 1, borderColor: `${colors.primary}40`,
    alignItems: 'center', padding: spacing.xl, marginBottom: spacing.base, ...shadows.md,
  },
  codeLabel: { fontSize: typography.xs, fontWeight: typography.bold as any, color: colors.textMuted, letterSpacing: 2, marginBottom: spacing.sm },
  codeValue: { fontSize: typography['4xl'], fontWeight: typography.bold as any, color: colors.accent, letterSpacing: 10, fontFamily: 'monospace', marginBottom: spacing.xs },
  codeHint: { fontSize: typography.xs, color: colors.textMuted, marginTop: spacing.xs },

  qrToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'center', marginBottom: spacing.base, padding: spacing.xs },
  qrToggleText: { color: colors.accent, fontSize: typography.sm, fontWeight: typography.medium as any },
  qrContainer: { alignItems: 'center', marginBottom: spacing.base },
  qrFrame: { padding: spacing.lg, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radii.xl, borderWidth: 1, borderColor: `${colors.primary}30`, position: 'relative', marginBottom: spacing.sm },
  qrCorner: { position: 'absolute', width: 20, height: 20, borderColor: colors.accent, borderTopWidth: 2.5, borderLeftWidth: 2.5, top: 8, left: 8 },
  qrCornerTR: { borderTopWidth: 2.5, borderRightWidth: 2.5, borderLeftWidth: 0, top: 8, left: undefined, right: 8 },
  qrCornerBL: { borderTopWidth: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5, top: undefined, bottom: 8, left: 8 },
  qrCornerBR: { borderTopWidth: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderLeftWidth: 0, top: undefined, bottom: 8, left: undefined, right: 8 },
  qrCaption: { fontSize: typography.xs, color: colors.textMuted },

  infoCard: { backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.base, marginBottom: spacing.base },

  // Establishing overlay
  establishingOverlay: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl,
  },
  establishingCard: {
    width: '100%', maxWidth: 340,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radii.xl, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    paddingVertical: spacing['2xl'], paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  establishingTitle: {
    color: palette.white, fontSize: typography.lg, fontWeight: typography.semibold as any,
    textAlign: 'center', marginTop: spacing.sm,
  },
  establishingSubtitle: {
    color: colors.textMuted, fontSize: typography.sm,
    textAlign: 'center', paddingHorizontal: spacing.sm,
  },
  estabSteps: { width: '100%', marginTop: spacing.sm, gap: 4 },
  estabCodeRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radii.md,
    paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: `${colors.primary}30`,
  },
  estabCodeLabel: { fontSize: typography.xs, color: colors.textMuted, letterSpacing: 1.5, fontWeight: typography.bold as any },
  estabCodeValue: { fontSize: typography.base, color: colors.accent, fontFamily: 'monospace', fontWeight: typography.bold as any, letterSpacing: 4 },
  loadingDisconnect: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xl, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  loadingDisconnectText: { color: colors.textMuted, fontSize: typography.sm },

  // Connected
  connectedBadge: { marginBottom: spacing.lg, borderRadius: radii.xl, overflow: 'hidden', borderWidth: 1, borderColor: `${colors.success}30` },
  connectedBadgeInner: { alignItems: 'center', padding: spacing.xl },
  connectedText: { fontSize: typography.xl, fontWeight: typography.bold as any, color: colors.success, marginTop: spacing.sm },
  connectedCount: { fontSize: typography.sm, color: `${colors.success}90`, marginTop: spacing.xs },
  streamLiveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.base },
  liveTag: { backgroundColor: colors.success, borderRadius: radii.sm, paddingHorizontal: spacing.xs + 2, paddingVertical: 2, marginLeft: spacing.xs },
  liveTagText: { color: palette.white, fontSize: 9, fontWeight: typography.bold as any, letterSpacing: 1 },

  stopBtnOutline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, borderWidth: 1.5, borderColor: `${colors.error}50`,
    borderRadius: radii.lg, paddingVertical: spacing.md, marginTop: spacing.sm,
  },
  stopBtnText: { color: colors.error, fontSize: typography.base, fontWeight: typography.semibold as any },
});