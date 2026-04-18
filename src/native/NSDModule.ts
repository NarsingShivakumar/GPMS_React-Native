// src/native/NSDModule.ts
import { NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';
import type { DiscoveredDevice } from '../store/slices/connectionSlice';

const { NSDModule: NativeNSDModule } = NativeModules;

if (!NativeNSDModule) {
  console.error('[NSDModule] Native module not found.');
}

const emitter = NativeNSDModule ? new NativeEventEmitter(NativeNSDModule) : null;

export const NSDModule = {
  registerService: (
    serviceName: string,
    port: number,
    shareCode: string
  ): Promise<string> =>
    NativeNSDModule.registerService(serviceName, port, shareCode),

  unregisterService: (): Promise<void> =>
    NativeNSDModule.unregisterService(),

  startDiscovery: (): Promise<void> =>
    NativeNSDModule.startDiscovery(),

  stopDiscovery: (): Promise<void> =>
    NativeNSDModule.stopDiscovery(),

  getDiscoveredDevices: (): Promise<DiscoveredDevice[]> =>
    NativeNSDModule.getDiscoveredDevices(),

  addListener: (
    eventName: 'onDeviceFound' | 'onDeviceLost',
    handler: (device: DiscoveredDevice) => void
  ): EmitterSubscription | null => {
    if (!emitter) return null;
    return emitter.addListener(eventName, handler);
  },
};
