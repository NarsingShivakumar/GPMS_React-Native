// src/hooks/usePermissions.ts
import { useCallback, useEffect } from 'react';
import { Platform, Alert, PermissionsAndroid } from 'react-native';  // ← use built-in
import { RESULTS, check, request, openSettings } from 'react-native-permissions';
import { useAppDispatch, useAppSelector } from '../store';
import {
  setCameraPermission,
  setLocationPermission,
  setNotificationPermission,
  setAccessibilityEnabled,
  type PermissionStatus,
} from '../store/slices/appSlice';
import { MirrorModule } from '../native/MirrorModule';

// Use raw Android permission strings — guaranteed non-null on all API levels
const ANDROID_PERMISSIONS = {
  CAMERA: 'android.permission.CAMERA' as const,
  LOCATION: 'android.permission.ACCESS_FINE_LOCATION' as const,
  NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' as const,
};

const toStatus = (result: string): PermissionStatus => {
  switch (result) {
    case RESULTS.GRANTED: return 'granted';
    case RESULTS.DENIED: return 'denied';
    case RESULTS.BLOCKED: return 'blocked';
    default: return 'unknown';
  }
};

export function usePermissions() {
  const dispatch = useAppDispatch();
  const { cameraPermission, locationPermission } = useAppSelector(s => s.app);

  const checkAll = useCallback(async () => {
    if (Platform.OS !== 'android') return;

    try {
      const camResult = await check(ANDROID_PERMISSIONS.CAMERA);
      dispatch(setCameraPermission(toStatus(camResult)));
    } catch { dispatch(setCameraPermission('unknown')); }

    try {
      const locResult = await check(ANDROID_PERMISSIONS.LOCATION);
      dispatch(setLocationPermission(toStatus(locResult)));
    } catch { dispatch(setLocationPermission('unknown')); }

    try {
      if (Platform.Version >= 33) {
        const notifResult = await check(ANDROID_PERMISSIONS.NOTIFICATIONS);
        dispatch(setNotificationPermission(toStatus(notifResult)));
      } else {
        dispatch(setNotificationPermission('granted'));
      }
    } catch { dispatch(setNotificationPermission('unknown')); }

    try {
      const a11y = await MirrorModule.isAccessibilityServiceEnabled();
      dispatch(setAccessibilityEnabled(a11y));
    } catch { dispatch(setAccessibilityEnabled(false)); }
  }, [dispatch]);

  const requestCamera = useCallback(async (): Promise<boolean> => {
    try {
      const result = await request(ANDROID_PERMISSIONS.CAMERA);
      dispatch(setCameraPermission(toStatus(result)));
      return result === RESULTS.GRANTED;
    } catch {
      dispatch(setCameraPermission('unknown'));
      return false;
    }
  }, [dispatch]);

  const requestLocation = useCallback(async (): Promise<boolean> => {
    try {
      const result = await request(ANDROID_PERMISSIONS.LOCATION);
      dispatch(setLocationPermission(toStatus(result)));
      return result === RESULTS.GRANTED;
    } catch {
      dispatch(setLocationPermission('unknown'));
      return false;
    }
  }, [dispatch]);

  const requestNotification = useCallback(async (): Promise<boolean> => {
    if (Platform.Version < 33) {
      dispatch(setNotificationPermission('granted'));
      return true;
    }
    try {
      const result = await request(ANDROID_PERMISSIONS.NOTIFICATIONS);
      dispatch(setNotificationPermission(toStatus(result)));
      return result === RESULTS.GRANTED;
    } catch {
      dispatch(setNotificationPermission('unknown'));
      return false;
    }
  }, [dispatch]);

  const requestAllRequired = useCallback(async (): Promise<{
    camera: boolean; location: boolean; notification: boolean;
  }> => {
    const cam = await requestCamera();
    const loc = await requestLocation();
    const notif = await requestNotification();
    return { camera: cam, location: loc, notification: notif };
  }, [requestCamera, requestLocation, requestNotification]);

  const checkAccessibility = useCallback(async (): Promise<boolean> => {
    try {
      const enabled = await MirrorModule.isAccessibilityServiceEnabled();
      dispatch(setAccessibilityEnabled(enabled));
      return enabled;
    } catch {
      return false;
    }
  }, [dispatch]);

  const promptAccessibility = useCallback(() => {
    Alert.alert(
      'Accessibility Permission Required',
      'MediMirror needs Accessibility access to enable remote control. Tap "Open Settings" and enable "MediMirror Remote Control".',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => MirrorModule.openAccessibilitySettings() },
      ]
    );
  }, []);

  const promptBlockedPermission = useCallback((name: string) => {
    Alert.alert(
      `${name} Permission Blocked`,
      `Please enable ${name} permission in device Settings to use this feature.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: openSettings },
      ]
    );
  }, []);

  useEffect(() => {
    checkAll();
  }, [checkAll]);

  return {
    cameraPermission,
    locationPermission,
    checkAll,
    requestCamera,
    requestLocation,
    requestNotification,
    requestAllRequired,
    checkAccessibility,
    promptAccessibility,
    promptBlockedPermission,
  };
}