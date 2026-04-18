// src/components/DeviceCard.tsx
import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
// FIX: correct Icon import (was commented-out and concatenated with theme import)
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
// FIX: theme import restored on its own line
import { colors, typography, spacing, radii, shadows, palette } from '../theme/theme';
import type { DiscoveredDevice } from '../store/slices/connectionSlice';

interface DeviceCardProps {
  device: DiscoveredDevice;
  onConnect: () => void;
}

export default function DeviceCard({ device, onConnect }: DeviceCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onIn = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start();
  const onOut = () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();

  const timeAgo = () => {
    const s = Math.floor((Date.now() - device.discoveredAt) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, styles.wrap]}>
      <TouchableOpacity activeOpacity={0.9} onPress={onConnect} onPressIn={onIn} onPressOut={onOut}>
        <LinearGradient
          colors={['rgba(14,58,110,0.55)', 'rgba(5,13,31,0.75)']}
          style={styles.card}>
          <View style={styles.iconWrap}>
            <Icon name="monitor-share" size={28} color={colors.primary} />
          </View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {device.displayName || device.serviceName}
            </Text>
            <View style={styles.metaRow}>
              <Icon name="ip-network" size={12} color={colors.textMuted} />
              <Text style={styles.meta}>{device.host}:{device.port}</Text>
            </View>
            {device.shareCode ? (
              <View style={styles.codePill}>
                <Text style={styles.codePillText}>{device.shareCode}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.right}>
            <View style={styles.onlineDot} />
            <Text style={styles.timeAgo}>{timeAgo()}</Text>
            <View style={styles.connectBtn}>
              <Icon name="arrow-right" size={18} color={palette.white} />
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm, borderRadius: radii.xl, overflow: 'hidden', borderWidth: 1, borderColor: `${colors.primary}30`, ...shadows.sm },
  card: { flexDirection: 'row', alignItems: 'center', padding: spacing.base, gap: spacing.sm },
  iconWrap: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: `${colors.primary}18`, borderWidth: 1, borderColor: `${colors.primary}30`, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  name: { fontSize: typography.base, fontWeight: typography.semibold, color: colors.textPrimary, marginBottom: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  meta: { fontSize: typography.xs, color: colors.textMuted, fontFamily: 'monospace' },
  codePill: { alignSelf: 'flex-start', backgroundColor: `${colors.accent}15`, borderWidth: 1, borderColor: `${colors.accent}30`, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  codePillText: { fontSize: typography.xs, color: colors.accent, fontWeight: typography.bold, letterSpacing: 2 },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  timeAgo: { fontSize: 10, color: colors.textMuted },
  connectBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.glow },
});
