// src/screens/ControlScreen.tsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, Animated, ScrollView,
  ActivityIndicator, Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Camera, CameraType } from 'react-native-camera-kit'; // ← replaces vision-camera
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useAppSelector, useAppDispatch } from '../store';
import { clearDiscoveredDevices } from '../store/slices/connectionSlice';
import { usePermissions } from '../hooks/usePermissions';
import { useNSDDiscovery } from '../hooks/useNSD';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { colors, typography, spacing, radii, shadows, palette } from '../theme/theme';
import DeviceCard from '../components/DeviceCard';

type Tab = 'scan' | 'code' | 'discover';
type Nav = StackNavigationProp<RootStackParamList, 'Control'>;
const DEFAULT_PORT = 8765;

function parseQRData(raw: string): { host: string; port: number; code: string } | null {
  try {
    const match = raw.match(/medimirror:\/\/([0-9.]+):(\d+)\?code=([A-Z0-9]+)/i);
    if (match) return { host: match[1], port: parseInt(match[2], 10), code: match[3] };
    const ipMatch = raw.match(/([0-9.]+):?(\d+)?/);
    if (ipMatch) return { host: ipMatch[1], port: parseInt(ipMatch[2] || '8765', 10), code: '' };
  } catch (_) { }
  return null;
}

export default function ControlScreen() {
  const nav = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const { cameraPermission, requestCamera, promptBlockedPermission } = usePermissions();
  const { discoveredDevices } = useAppSelector(s => s.connection);

  const [tab, setTab] = useState<Tab>('scan');
  const [scanning, setScanning] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [hostError, setHostError] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scannedRef = useRef(false);

  useNSDDiscovery(tab === 'discover');

  const navigateToViewer = useCallback((
    host: string, port: number, code: string, name?: string
  ) => {
    nav.navigate('Viewer', { host, port, shareCode: code, deviceName: name });
  }, [nav]);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    if (tab === 'scan' && cameraPermission !== 'granted') {
      requestCamera().then(granted => { if (!granted) promptBlockedPermission('Camera'); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    scannedRef.current = false;
    setScanning(tab === 'scan');
  }, [tab]);

  // ─── camera-kit QR handler — no hooks needed, just a callback prop
  const handleQRRead = useCallback((event: { nativeEvent: { codeStringValue: string } }) => {
    if (scannedRef.current) return;
    const raw = event.nativeEvent.codeStringValue;
    if (!raw) return;
    const parsed = parseQRData(raw);
    if (parsed) {
      scannedRef.current = true;
      setScanning(false);
      Vibration.vibrate(100);
      navigateToViewer(parsed.host, parsed.port, parsed.code);
    }
  }, [navigateToViewer]);

  const handleManualConnect = useCallback(() => {
    setHostError('');
    const trimHost = hostInput.trim();
    const trimCode = codeInput.trim().toUpperCase();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(trimHost)) {
      setHostError('Enter a valid IP address (e.g. 192.168.1.10)');
      return;
    }
    navigateToViewer(trimHost, DEFAULT_PORT, trimCode);
  }, [hostInput, codeInput, navigateToViewer]);

  const handleCodeConnect = useCallback(() => {
    const code = codeInput.trim().toUpperCase();
    if (code.length < 4) {
      setHostError('Enter a valid share code (at least 4 characters)');
      return;
    }
    const match = discoveredDevices.find(d =>
      d.shareCode.toUpperCase() === code || d.displayName.includes(code)
    );
    if (match) {
      navigateToViewer(match.host, match.port, match.shareCode, match.displayName);
    } else {
      setHostError('Device not found nearby. Try entering the IP address manually.');
    }
  }, [codeInput, discoveredDevices, navigateToViewer]);

  // ─── RENDER HELPERS ───────────────────────────────────────────────────────

  const renderScanTab = () => {
    if (cameraPermission === 'denied' || cameraPermission === 'blocked') {
      return (
        <View style={styles.permissionWrap}>
          <Icon name="camera-off" size={60} color={colors.textMuted} />
          <Text style={styles.permLabel}>Camera permission required</Text>
          <Text style={styles.permSubLabel}>Tap below to grant camera access for QR scanning</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestCamera}>
            <Text style={styles.permBtnText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.scannerContainer}>
        {/* react-native-camera-kit: no hooks, no worklets, New Arch compatible */}
        <Camera
          style={StyleSheet.absoluteFill}
          cameraType={CameraType.Back}
          scanBarcode={scanning && tab === 'scan'}
          onReadCode={handleQRRead}
          showFrame={false}               // we draw our own overlay below
          laserColor="transparent"
          frameColor="transparent"
        />
        <View style={styles.scanOverlay}>
          <View style={styles.scanCornerTL} />
          <View style={styles.scanCornerTR} />
          <View style={styles.scanCornerBL} />
          <View style={styles.scanCornerBR} />
          <ScanLine />
        </View>
        <Text style={styles.scanHint}>Align QR code within the frame</Text>
      </View>
    );
  };

  const renderCodeTab = () => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.codeTabContent} keyboardShouldPersistTaps="handled">
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Enter Share Code</Text>
          <Text style={styles.formSubtitle}>Get the share code from the Sharing device</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>SHARE CODE</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={codeInput}
              onChangeText={v => { setCodeInput(v.toUpperCase()); setHostError(''); }}
              placeholder="e.g. ABC123"
              placeholderTextColor={colors.textMuted}
              maxLength={8}
              autoCapitalize="characters"
            />
          </View>
          {!!hostError && (
            <View style={styles.errorRow}>
              <Icon name="alert-circle" size={14} color={colors.error} />
              <Text style={styles.errorText}>{hostError}</Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.connectBtn, !codeInput.trim() && styles.connectBtnDisabled]}
            onPress={handleCodeConnect}
            disabled={!codeInput.trim()}>
            <LinearGradient
              colors={codeInput.trim() ? [colors.accent, colors.accentDark] : ['#333', '#222']}
              style={styles.connectBtnGrad}>
              <Icon name="link-variant" size={20} color={palette.white} />
              <Text style={styles.connectBtnText}>Connect</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={styles.dividerOr}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR ENTER IP</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Manual Connection</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>IP ADDRESS</Text>
            <TextInput
              style={styles.input}
              value={hostInput}
              onChangeText={v => { setHostInput(v); setHostError(''); }}
              placeholder="192.168.1.10"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              autoCorrect={false}
            />
          </View>
          <TouchableOpacity
            style={[styles.connectBtn, !hostInput.trim() && styles.connectBtnDisabled]}
            onPress={handleManualConnect}
            disabled={!hostInput.trim()}>
            <LinearGradient
              colors={hostInput.trim() ? [colors.primary, colors.primaryDark] : ['#333', '#222']}
              style={styles.connectBtnGrad}>
              <Icon name="ethernet" size={20} color={palette.white} />
              <Text style={styles.connectBtnText}>Connect via IP</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderDiscoverTab = () => (
    <ScrollView contentContainerStyle={styles.discoverContent} showsVerticalScrollIndicator={false}>
      <View style={styles.discoverHeader}>
        <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.sm }} />
        <Text style={styles.discoverStatus}>Scanning WiFi network…</Text>
        <TouchableOpacity onPress={() => dispatch(clearDiscoveredDevices())} style={styles.refreshBtn}>
          <Icon name="refresh" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>
      {discoveredDevices.length === 0 ? (
        <View style={styles.emptyDiscover}>
          <Icon name="access-point-network-off" size={60} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Devices Found</Text>
          <Text style={styles.emptySubtitle}>
            Make sure the Sharing device is on the same WiFi and broadcasting
          </Text>
        </View>
      ) : (
        discoveredDevices.map(d => (
          <DeviceCard
            key={d.serviceName}
            device={d}
            onConnect={() => navigateToViewer(d.host, d.port, d.shareCode, d.displayName)}
          />
        ))
      )}
    </ScrollView>
  );

  return (
    <LinearGradient colors={[palette.navy, palette.navyMid]} style={styles.bg}>
      <SafeAreaView style={styles.safe}>
        <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn}>
              <Icon name="arrow-left" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Control Device</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.tabBar}>
            {(['scan', 'code', 'discover'] as Tab[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.tab, tab === t && styles.tabActive]}
                onPress={() => setTab(t)}>
                <Icon
                  name={t === 'scan' ? 'qrcode-scan' : t === 'code' ? 'keyboard' : 'access-point'}
                  size={18}
                  color={tab === t ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'scan' ? 'Scan QR' : t === 'code' ? 'Enter Code' : 'Discover'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flex: 1 }}>
            {tab === 'scan' && renderScanTab()}
            {tab === 'code' && renderCodeTab()}
            {tab === 'discover' && renderDiscoverTab()}
          </View>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function ScanLine() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-90, 90] });
  return <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />;
}

const SCAN_BOX = 220;
const styles = StyleSheet.create({
  bg: { flex: 1 },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.base, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, backgroundColor: colors.bgLight },
  headerTitle: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.textPrimary },
  tabBar: { flexDirection: 'row', backgroundColor: colors.bgLight, margin: spacing.base, borderRadius: radii.lg, padding: 4, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderRadius: radii.md },
  tabActive: { backgroundColor: `${colors.primary}20`, borderWidth: 1, borderColor: `${colors.primary}35` },
  tabText: { fontSize: typography.sm, color: colors.textMuted, fontWeight: typography.medium },
  tabTextActive: { color: colors.primary, fontWeight: typography.semibold },
  scannerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  scanOverlay: { width: SCAN_BOX, height: SCAN_BOX, alignItems: 'center', justifyContent: 'center' },
  scanLine: { position: 'absolute', width: SCAN_BOX - 40, height: 2, backgroundColor: colors.accent, opacity: 0.8, borderRadius: 1 },
  scanCornerTL: { position: 'absolute', top: 0, left: 0, width: 28, height: 28, borderTopWidth: 3, borderLeftWidth: 3, borderColor: colors.accent },
  scanCornerTR: { position: 'absolute', top: 0, right: 0, width: 28, height: 28, borderTopWidth: 3, borderRightWidth: 3, borderColor: colors.accent },
  scanCornerBL: { position: 'absolute', bottom: 0, left: 0, width: 28, height: 28, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: colors.accent },
  scanCornerBR: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderBottomWidth: 3, borderRightWidth: 3, borderColor: colors.accent },
  scanHint: { position: 'absolute', bottom: 60, color: colors.textSecondary, fontSize: typography.sm, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: spacing.base, paddingVertical: spacing.xs, borderRadius: radii.full, overflow: 'hidden' },
  permissionWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'] },
  permLabel: { color: colors.textPrimary, fontSize: typography.lg, fontWeight: typography.semibold, marginTop: spacing.base, textAlign: 'center' },
  permSubLabel: { color: colors.textSecondary, fontSize: typography.sm, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xl },
  permBtn: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  permBtnText: { color: palette.white, fontWeight: typography.semibold, fontSize: typography.base },
  codeTabContent: { padding: spacing.base, paddingBottom: spacing['4xl'] },
  formCard: { backgroundColor: colors.bgCard, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.base, ...shadows.sm },
  formTitle: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.textPrimary, marginBottom: spacing.xs },
  formSubtitle: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: spacing.base },
  inputGroup: { marginBottom: spacing.base },
  inputLabel: { fontSize: typography.xs, fontWeight: typography.bold, color: colors.textMuted, letterSpacing: 1.5, marginBottom: spacing.xs },
  input: { backgroundColor: colors.bgLight, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.textPrimary, fontSize: typography.base },
  codeInput: { fontSize: typography['2xl'], fontWeight: typography.bold, color: colors.accent, letterSpacing: 6, textAlign: 'center', fontFamily: 'monospace' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  errorText: { color: colors.error, fontSize: typography.sm },
  connectBtn: { borderRadius: radii.lg, overflow: 'hidden', ...shadows.glow },
  connectBtnDisabled: { opacity: 0.5 },
  connectBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md + 2, gap: spacing.sm },
  connectBtnText: { color: palette.white, fontSize: typography.base, fontWeight: typography.bold },
  dividerOr: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.base },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontSize: typography.xs, letterSpacing: 2, marginHorizontal: spacing.sm },
  discoverContent: { padding: spacing.base, paddingBottom: spacing['4xl'] },
  discoverHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.base, paddingVertical: spacing.sm },
  discoverStatus: { flex: 1, color: colors.textSecondary, fontSize: typography.sm },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: `${colors.primary}15`, alignItems: 'center', justifyContent: 'center' },
  emptyDiscover: { alignItems: 'center', paddingTop: spacing['4xl'] },
  emptyTitle: { color: colors.textPrimary, fontSize: typography.xl, fontWeight: typography.semibold, marginTop: spacing.base },
  emptySubtitle: { color: colors.textSecondary, fontSize: typography.sm, textAlign: 'center', marginTop: spacing.sm, lineHeight: typography.sm * 1.6 },
});