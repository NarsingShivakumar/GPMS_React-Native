// src/screens/HomeScreen.tsx
import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
// FIX: correct import — react-native-vector-icons/MaterialCommunityIcons (NOT @react-native-vector-icons/...)
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useAppDispatch } from '../store';
import { setRole } from '../store/slices/appSlice';
import { colors, typography, spacing, radii, shadows, palette } from '../theme/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { usePermissions } from '../hooks/usePermissions';

const { width } = Dimensions.get('window');
type Nav = StackNavigationProp<RootStackParamList, 'Home'>;

const PulseRing = ({ delay = 0, size = 240 }: { delay?: number; size?: number }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.6] });
  const opacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 0.08, 0] });
  return (
    <Animated.View
      style={{  // FIX: pointerEvents moved to style in RN 0.73+
        position: 'absolute',
        width: size, height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: colors.primary,
        transform: [{ scale }],
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};

export default function HomeScreen() {
  const nav = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const { requestAllRequired } = usePermissions();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(32)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();
    requestAllRequired();
  }, []);

  return (
    <LinearGradient
      colors={[palette.navy, palette.navyMid, '#071530']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.bg}>
      <SafeAreaView style={styles.safe}>
        <View style={[styles.glowContainer, { pointerEvents: 'none' }]}>
          <View style={[styles.glow, styles.glowTL]} />
          <View style={[styles.glow, styles.glowBR]} />
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoWrap}>
              <Icon name="medical-bag" size={28} color={colors.accent} />
            </View>
            <View style={styles.titleWrap}>
              <Text style={styles.appName}>MediMirror</Text>
              <Text style={styles.appTagline}>Clinical Screen Sharing</Text>
            </View>
          </View>

          {/* Hero */}
          <View style={styles.heroContainer}>
            <PulseRing delay={0} size={220} />
            <PulseRing delay={800} size={220} />
            <PulseRing delay={1600} size={220} />
            <LinearGradient colors={[colors.primaryDark, colors.primary]} style={styles.heroBadge}>
              <Icon name="monitor-share" size={52} color={palette.white} />
            </LinearGradient>
          </View>

          <Text style={styles.heroHeading}>Secure Device{'\n'}Screen Sharing</Text>
          <Text style={styles.heroSubtitle}>
            Real-time screen mirroring over local WiFi for clinical teams
          </Text>

          <View style={styles.cardsRow}>
            <RoleCard
              icon="cast"
              label="Share Screen"
              description="Broadcast your display to connected devices"
              accentColor={colors.primary}
              glowColor={colors.primaryGlow}
              onPress={() => { dispatch(setRole('sharing')); nav.navigate('Sharing'); }}
            />
            <RoleCard
              icon="remote-desktop"
              label="Control Device"
              description="View and control a sharing device remotely"
              accentColor={colors.accent}
              glowColor={colors.accentGlow}
              onPress={() => { dispatch(setRole('control')); nav.navigate('Control'); }}
            />
          </View>

          <Text style={styles.footer}>Devices must be on the same WiFi network</Text>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function RoleCard({ icon, label, description, accentColor, glowColor, onPress }: {
  icon: string; label: string; description: string;
  accentColor: string; glowColor: string; onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start()}
        style={[styles.roleCard, { borderColor: `${accentColor}55` }]}>
        <LinearGradient
          colors={['rgba(14,58,110,0.6)', 'rgba(5,13,31,0.8)']}
          style={styles.roleCardGradient}>
          <View style={[styles.roleIconWrap, { backgroundColor: glowColor, borderColor: `${accentColor}40` }]}>
            <Icon name={icon} size={28} color={accentColor} />
          </View>
          <Text style={[styles.roleLabel, { color: accentColor }]}>{label}</Text>
          <Text style={styles.roleDesc}>{description}</Text>
          <View style={[styles.roleArrow, { backgroundColor: accentColor }]}>
            <Icon name="arrow-right" size={14} color={palette.white} />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  safe: { flex: 1 },
  glowContainer: { ...StyleSheet.absoluteFillObject },
  glow: { position: 'absolute', borderRadius: 999, opacity: 0.18 },
  glowTL: { width: 320, height: 320, top: -80, left: -80, backgroundColor: colors.primary },
  glowBR: { width: 280, height: 280, bottom: -60, right: -60, backgroundColor: colors.accent },
  content: { flex: 1, paddingHorizontal: spacing.base, paddingTop: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl },
  logoWrap: {
    width: 44, height: 44, borderRadius: radii.md,
    backgroundColor: 'rgba(38,198,218,0.15)', borderWidth: 1,
    borderColor: `${colors.accent}40`, alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  titleWrap: {},
  appName: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.textPrimary, letterSpacing: 0.5 },
  appTagline: { fontSize: typography.xs, fontWeight: typography.medium, color: colors.accent, letterSpacing: 1.5, textTransform: 'uppercase' },
  heroContainer: {
    alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
    width: 220, height: 220, marginBottom: spacing.xl,
  },
  heroBadge: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', ...shadows.lg },
  heroHeading: {
    fontSize: typography['3xl'], fontWeight: typography.bold, color: colors.textPrimary,
    textAlign: 'center', letterSpacing: -0.5, lineHeight: typography['3xl'] * 1.2, marginBottom: spacing.sm,
  },
  heroSubtitle: {
    fontSize: typography.base, color: colors.textSecondary, textAlign: 'center',
    lineHeight: typography.base * 1.6, paddingHorizontal: spacing.md, marginBottom: spacing['2xl'],
  },
  cardsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  roleCard: { borderRadius: radii.xl, borderWidth: 1, overflow: 'hidden', ...shadows.md },
  roleCardGradient: { padding: spacing.base, paddingVertical: spacing.lg, alignItems: 'flex-start', minHeight: 180 },
  roleIconWrap: { width: 52, height: 52, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  roleLabel: { fontSize: typography.md, fontWeight: typography.bold, marginBottom: spacing.xs, letterSpacing: 0.3 },
  roleDesc: { fontSize: typography.sm, color: colors.textMuted, lineHeight: typography.sm * 1.5, flex: 1 },
  roleArrow: { marginTop: spacing.sm, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  footer: { textAlign: 'center', fontSize: typography.xs, color: colors.textMuted, letterSpacing: 0.3, paddingBottom: spacing.base },
});
