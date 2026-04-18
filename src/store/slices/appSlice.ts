// src/store/slices/appSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type AppRole = 'none' | 'sharing' | 'control';
export type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'blocked';

interface AppState {
  role: AppRole;
  isInitialized: boolean;
  cameraPermission: PermissionStatus;
  locationPermission: PermissionStatus;
  notificationPermission: PermissionStatus;
  accessibilityEnabled: boolean;
  localIpAddress: string;
  deviceName: string;
  error: string | null;
}

const initialState: AppState = {
  role: 'none',
  isInitialized: false,
  cameraPermission: 'unknown',
  locationPermission: 'unknown',
  notificationPermission: 'unknown',
  accessibilityEnabled: false,
  localIpAddress: '0.0.0.0',
  deviceName: 'Unknown Device',
  error: null,
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setRole: (state, action: PayloadAction<AppRole>) => {
      state.role = action.payload;
    },
    setInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    setCameraPermission: (state, action: PayloadAction<PermissionStatus>) => {
      state.cameraPermission = action.payload;
    },
    setLocationPermission: (state, action: PayloadAction<PermissionStatus>) => {
      state.locationPermission = action.payload;
    },
    setNotificationPermission: (state, action: PayloadAction<PermissionStatus>) => {
      state.notificationPermission = action.payload;
    },
    setAccessibilityEnabled: (state, action: PayloadAction<boolean>) => {
      state.accessibilityEnabled = action.payload;
    },
    setLocalIpAddress: (state, action: PayloadAction<string>) => {
      state.localIpAddress = action.payload;
    },
    setDeviceName: (state, action: PayloadAction<string>) => {
      state.deviceName = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    resetApp: () => initialState,
  },
});

export const {
  setRole, setInitialized, setCameraPermission, setLocationPermission,
  setNotificationPermission, setAccessibilityEnabled, setLocalIpAddress,
  setDeviceName, setError, clearError, resetApp,
} = appSlice.actions;

export default appSlice.reducer;
