// src/hooks/useNSD.ts
import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAppDispatch, useAppSelector } from '../store';
import {
  addDiscoveredDevice,
  removeDiscoveredDevice,
  clearDiscoveredDevices,
  setIsScanning,
  setScanError,
} from '../store/slices/connectionSlice';
import { NSDModule } from '../native/NSDModule';
import type { DiscoveredDevice } from '../store/slices/connectionSlice';

export function useNSDDiscovery(active: boolean) {
  const dispatch = useAppDispatch();
  const subFoundRef = useRef<any>(null);
  const subLostRef = useRef<any>(null);
  const mountedRef = useRef(true);

  const startDiscovery = useCallback(async () => {
    if (!mountedRef.current) return;
    dispatch(clearDiscoveredDevices());
    dispatch(setIsScanning(true));
    dispatch(setScanError(null));

    subFoundRef.current = NSDModule.addListener('onDeviceFound', (device: DiscoveredDevice) => {
      if (mountedRef.current) dispatch(addDiscoveredDevice(device));
    });
    subLostRef.current = NSDModule.addListener('onDeviceLost', (device: DiscoveredDevice) => {
      if (mountedRef.current) dispatch(removeDiscoveredDevice(device.serviceName));
    });

    try {
      await NSDModule.startDiscovery();
    } catch (e: any) {
      dispatch(setScanError(e?.message || 'Discovery failed'));
      dispatch(setIsScanning(false));
    }
  }, [dispatch]);

  const stopDiscovery = useCallback(async () => {
    subFoundRef.current?.remove();
    subLostRef.current?.remove();
    subFoundRef.current = null;
    subLostRef.current = null;
    try {
      await NSDModule.stopDiscovery();
    } catch (_) {}
    dispatch(setIsScanning(false));
  }, [dispatch]);

  const refresh = useCallback(async () => {
    await stopDiscovery();
    setTimeout(startDiscovery, 500);
  }, [startDiscovery, stopDiscovery]);

  useEffect(() => {
    mountedRef.current = true;
    if (active) startDiscovery();

    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && active) refresh();
      else if (state === 'background') stopDiscovery();
    });

    return () => {
      mountedRef.current = false;
      stopDiscovery();
      appStateSub.remove();
    };
  }, [active]);

  return { startDiscovery, stopDiscovery, refresh };
}

export function useNSDRegistration() {
  const mountedRef = useRef(true);

  const register = useCallback(async (
    deviceName: string,
    port: number,
    shareCode: string
  ): Promise<string | null> => {
    try {
      const name = await NSDModule.registerService(deviceName, port, shareCode);
      return name;
    } catch (e: any) {
      console.error('[NSD] Registration error', e);
      return null;
    }
  }, []);

  const unregister = useCallback(async () => {
    try {
      await NSDModule.unregisterService();
    } catch (_) {}
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      unregister();
    };
  }, []);

  return { register, unregister };
}
