// src/native/MirrorModule.ts
import { NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';

const { MirrorModule: NativeMirrorModule } = NativeModules;

if (!NativeMirrorModule) {
  console.error('[MirrorModule] Native module not found. Ensure the package is properly registered.');
}

export interface CaptureInfo {
  isRunning: boolean;
  shareCode: string;
  ipAddress: string;
  port: number;
  accessibilityEnabled: boolean;
}

export interface StartCaptureResult {
  shareCode: string;
  ipAddress: string;
  port: number;
  connectionString: string;
  qrData: string;
}

const emitter = NativeMirrorModule ? new NativeEventEmitter(NativeMirrorModule) : null;

export const MirrorModule = {
  startScreenCapture: (): Promise<StartCaptureResult> =>
    NativeMirrorModule.startScreenCapture(),

  stopScreenCapture: (): Promise<void> =>
    NativeMirrorModule.stopScreenCapture(),

  getCaptureInfo: (): Promise<CaptureInfo> =>
    NativeMirrorModule.getCaptureInfo(),

  getLocalIp: (): Promise<string> =>
    NativeMirrorModule.getLocalIp(),

  isAccessibilityServiceEnabled: (): Promise<boolean> =>
    NativeMirrorModule.isAccessibilityServiceEnabled(),

  openAccessibilitySettings: (): Promise<void> =>
    NativeMirrorModule.openAccessibilitySettings(),

  getServerPort: (): Promise<number> =>
    NativeMirrorModule.getServerPort(),

  addListener: (eventName: string, handler: (event: any) => void): EmitterSubscription | null => {
    if (!emitter) return null;
    return emitter.addListener(eventName, handler);
  },
};

export type MirrorEvent =
  | 'onCaptureStarted'
  | 'onClientConnected'
  | 'onClientDisconnected'
  | 'onCaptureError';
