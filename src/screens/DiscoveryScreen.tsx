// src/screens/DiscoveryScreen.tsx
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
// FIX: correct import
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useAppSelector } from '../store';
import { useNSDDiscovery } from '../hooks/useNSD';
import { colors, typography, spacing, radii, palette } from '../theme/theme';
import DeviceCard from '../components/DeviceCard';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Nav = StackNavigationProp<RootStackParamList, 'Discovery'>;

export default function DiscoveryScreen() {
  const nav = useNavigation<Nav>();
  const { discoveredDevices, isScanning } = useAppSelector(s => s.connection);
  const { refresh } = useNSDDiscovery(true);

  return (
    <LinearGradient colors={[palette.navy, palette.navyMid]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Nearby Devices</Text>
          <TouchableOpacity onPress={refresh} style={styles.refreshBtn}>
            <Icon name="refresh" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {isScanning && (
          <View style={styles.scanningBar}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.scanningText}>Scanning WiFi network…</Text>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {discoveredDevices.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="wifi-off" size={64} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No devices found</Text>
              <Text style={styles.emptyText}>
                Ensure sharing device is on the same WiFi and broadcasting
              </Text>
            </View>
          ) : (
            discoveredDevices.map(device => (
              <DeviceCard
                key={device.serviceName}
                device={device}
                onConnect={() =>
                  nav.navigate('Viewer', {
                    host: device.host,
                    port: device.port,
                    shareCode: device.shareCode,
                    deviceName: device.displayName,
                  })
                }
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.base, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.bgLight, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.textPrimary },
  refreshBtn: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: `${colors.primary}15`, alignItems: 'center', justifyContent: 'center' },
  scanningBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, backgroundColor: `${colors.primary}10`, borderBottomWidth: 1, borderBottomColor: colors.border },
  scanningText: { color: colors.textSecondary, fontSize: typography.sm },
  list: { padding: spacing.base, paddingBottom: spacing['4xl'] },
  empty: { alignItems: 'center', paddingTop: spacing['5xl'], paddingHorizontal: spacing['2xl'] },
  emptyTitle: { fontSize: typography.xl, fontWeight: typography.semibold, color: colors.textPrimary, marginTop: spacing.base, marginBottom: spacing.sm },
  emptyText: { fontSize: typography.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: typography.sm * 1.6 },
});
