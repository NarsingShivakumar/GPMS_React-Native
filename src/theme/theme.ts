import { StyleSheet, TextStyle, ViewStyle, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const palette = {
  // Core medical blues
  navy: '#050D1F',
  navyMid: '#0A1628',
  navyLight: '#0F1E38',
  blue900: '#0D2347',
  blue800: '#0E3A6E',
  blue700: '#0F52A0',
  blue600: '#1565C0',
  blue500: '#1976D2',
  blue400: '#2196F3',
  blue300: '#42A5F5',
  blue200: '#90CAF9',
  blue100: '#BBDEFB',
  blue50: '#E3F2FD',

  // Teal / health green
  teal700: '#00695C',
  teal600: '#00796B',
  teal500: '#009688',
  teal400: '#26A69A',
  teal300: '#4DB6AC',
  cyan500: '#00BCD4',
  cyan400: '#26C6DA',
  cyan300: '#4DD0E1',

  // Status
  success: '#00E676',
  successDim: '#00C853',
  warning: '#FFB300',
  warningDim: '#FF8F00',
  error: '#FF1744',
  errorDim: '#D50000',

  // Greys
  white: '#FFFFFF',
  grey50: '#FAFAFA',
  grey100: '#F5F5F5',
  grey200: '#EEEEEE',
  grey300: '#E0E0E0',
  grey400: '#BDBDBD',
  grey500: '#9E9E9E',
  grey600: '#757575',
  grey700: '#616161',
  grey800: '#424242',
  grey900: '#212121',
  black: '#000000',

  // Glass / overlay
  glassDark: 'rgba(10, 22, 40, 0.85)',
  glassBlue: 'rgba(13, 35, 71, 0.75)',
  glassLight: 'rgba(255,255,255,0.08)',
  glassLighter: 'rgba(255,255,255,0.12)',
  overlay: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
};

export const colors = {
  // Backgrounds
  bg: palette.navy,
  bgMid: palette.navyMid,
  bgLight: palette.navyLight,
  bgCard: palette.blue900,
  bgElevated: 'rgba(14, 58, 110, 0.4)',

  // Primary brand
  primary: palette.blue400,
  primaryDark: palette.blue600,
  primaryLight: palette.blue200,
  primaryGlow: 'rgba(33, 150, 243, 0.25)',

  // Accent
  accent: palette.cyan400,
  accentDark: palette.cyan500,
  accentGlow: 'rgba(38, 198, 218, 0.2)',

  // Secondary
  secondary: palette.teal400,
  secondaryGlow: 'rgba(77, 182, 172, 0.2)',

  // Text
  textPrimary: '#E8F4FD',
  textSecondary: 'rgba(232, 244, 253, 0.6)',
  textMuted: 'rgba(232, 244, 253, 0.35)',
  textDisabled: 'rgba(232, 244, 253, 0.2)',
  textInverse: palette.navy,

  // Borders
  border: 'rgba(33, 150, 243, 0.2)',
  borderStrong: 'rgba(33, 150, 243, 0.45)',
  borderLight: 'rgba(255,255,255,0.07)',

  // Status
  success: palette.success,
  warning: palette.warning,
  error: palette.error,

  // Misc
  glass: palette.glassDark,
  overlay: palette.overlay,
};

export const typography = {
  // Font families
  fontMono: 'Courier New',

  // Sizes
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 26,
  '3xl': 32,
  '4xl': 40,
  '5xl': 52,

  // Weights (as named constants for clarity)
  thin: '100' as TextStyle['fontWeight'],
  light: '300' as TextStyle['fontWeight'],
  regular: '400' as TextStyle['fontWeight'],
  medium: '500' as TextStyle['fontWeight'],
  semibold: '600' as TextStyle['fontWeight'],
  bold: '700' as TextStyle['fontWeight'],
  extrabold: '800' as TextStyle['fontWeight'],

  // Line heights
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.7,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  '5xl': 64,
};

export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  full: 9999,
};

export const shadows = {
  sm: {
    shadowColor: palette.blue400,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  md: {
    shadowColor: palette.blue400,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  lg: {
    shadowColor: palette.blue400,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  glow: {
    shadowColor: palette.blue400,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 8,
  },
  accentGlow: {
    shadowColor: palette.cyan400,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
  successGlow: {
    shadowColor: palette.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
};

// Reusable component styles
export const globalStyles = StyleSheet.create({
  flex1: { flex: 1 },
  flexRow: { flexDirection: 'row' },
  flexRowCenter: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  absolute: { position: 'absolute' },
  absoluteFill: StyleSheet.absoluteFillObject,

  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  safeContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
    ...shadows.md,
  },

  cardElevated: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.base,
    ...shadows.lg,
  },

  glassCard: {
    backgroundColor: 'rgba(14, 58, 110, 0.45)',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.base,
  },

  // Buttons
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.glow,
  },
  btnPrimaryText: {
    color: palette.white,
    fontSize: typography.base,
    fontWeight: typography.bold,
    letterSpacing: 0.5,
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: {
    color: colors.primary,
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },

  // Text
  heading1: {
    color: colors.textPrimary,
    fontSize: typography['3xl'],
    fontWeight: typography.bold,
    letterSpacing: -0.5,
    lineHeight: typography['3xl'] * typography.tight,
  },
  heading2: {
    color: colors.textPrimary,
    fontSize: typography['2xl'],
    fontWeight: typography.bold,
    letterSpacing: -0.3,
  },
  heading3: {
    color: colors.textPrimary,
    fontSize: typography.xl,
    fontWeight: typography.semibold,
  },
  bodyText: {
    color: colors.textSecondary,
    fontSize: typography.base,
    fontWeight: typography.regular,
    lineHeight: typography.base * typography.normal,
  },
  captionText: {
    color: colors.textMuted,
    fontSize: typography.sm,
    fontWeight: typography.regular,
  },
  labelText: {
    color: colors.textSecondary,
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  codeText: {
    fontFamily: typography.fontMono,
    color: colors.accent,
    fontSize: typography.xl,
    letterSpacing: 6,
    fontWeight: typography.bold,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },

  // Input
  input: {
    backgroundColor: colors.bgLight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    color: colors.textPrimary,
    fontSize: typography.base,
  },
  inputFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.bgCard,
  },

  // Badge
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: colors.primaryGlow,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  badgeText: {
    color: colors.primary,
    fontSize: typography.xs,
    fontWeight: typography.semibold,
  },

  // Status dot
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotOnline: {
    backgroundColor: colors.success,
  },
  statusDotOffline: {
    backgroundColor: colors.error,
  },
});

export const SCREEN = {
  WIDTH: SCREEN_WIDTH,
  HEIGHT: SCREEN_HEIGHT,
};

export default {
  palette,
  colors,
  typography,
  spacing,
  radii,
  shadows,
  globalStyles,
  SCREEN,
};
