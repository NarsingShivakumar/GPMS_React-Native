// src/store/slices/connectionSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type ConnectionState =
  | 'idle' | 'advertising' | 'waiting' | 'connecting'
  | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface DiscoveredDevice {
  serviceName: string;
  host: string;
  port: number;
  shareCode: string;
  displayName: string;
  discoveredAt: number;
  signalStrength?: 'strong' | 'medium' | 'weak';
}

export interface ConnectionInfo {
  shareCode: string;
  ipAddress: string;
  port: number;
  qrData: string;
  connectionString: string;
}

interface ConnectionSliceState {
  status: ConnectionState;
  connectionInfo: ConnectionInfo | null;
  connectedDeviceIp: string | null;
  discoveredDevices: DiscoveredDevice[];
  clientCount: number;
  isScanning: boolean;
  scanError: string | null;
  enteredCode: string;
  manualHost: string;
  reconnectAttempts: number;
  lastConnectedAt: number | null;
  latency: number;
}

const initialState: ConnectionSliceState = {
  status: 'idle',
  connectionInfo: null,
  connectedDeviceIp: null,
  discoveredDevices: [],
  clientCount: 0,
  isScanning: false,
  scanError: null,
  enteredCode: '',
  manualHost: '',
  reconnectAttempts: 0,
  lastConnectedAt: null,
  latency: 0,
};

const connectionSlice = createSlice({
  name: 'connection',
  initialState,
  reducers: {
    setStatus: (state, action: PayloadAction<ConnectionState>) => {
      state.status = action.payload;
    },
    setConnectionInfo: (state, action: PayloadAction<ConnectionInfo | null>) => {
      state.connectionInfo = action.payload;
      if (action.payload) state.status = 'advertising';
    },
    setConnectedDeviceIp: (state, action: PayloadAction<string | null>) => {
      state.connectedDeviceIp = action.payload;
    },
    addDiscoveredDevice: (state, action: PayloadAction<DiscoveredDevice>) => {
      const idx = state.discoveredDevices.findIndex(
        d => d.serviceName === action.payload.serviceName
      );
      if (idx >= 0) {
        state.discoveredDevices[idx] = action.payload;
      } else {
        state.discoveredDevices.unshift(action.payload);
      }
    },
    removeDiscoveredDevice: (state, action: PayloadAction<string>) => {
      state.discoveredDevices = state.discoveredDevices.filter(
        d => d.serviceName !== action.payload
      );
    },
    clearDiscoveredDevices: (state) => {
      state.discoveredDevices = [];
    },
    setClientCount: (state, action: PayloadAction<number>) => {
      state.clientCount = action.payload;
    },
    incrementClientCount: (state) => {
      state.clientCount += 1;
      state.status = 'connected';
      state.lastConnectedAt = Date.now();
    },
    decrementClientCount: (state) => {
      state.clientCount = Math.max(0, state.clientCount - 1);
      if (state.clientCount === 0) {
        state.status = 'waiting';
        state.connectedDeviceIp = null;
      }
    },
    setIsScanning: (state, action: PayloadAction<boolean>) => {
      state.isScanning = action.payload;
    },
    setScanError: (state, action: PayloadAction<string | null>) => {
      state.scanError = action.payload;
    },
    setEnteredCode: (state, action: PayloadAction<string>) => {
      state.enteredCode = action.payload.toUpperCase();
    },
    setManualHost: (state, action: PayloadAction<string>) => {
      state.manualHost = action.payload;
    },
    setReconnectAttempts: (state, action: PayloadAction<number>) => {
      state.reconnectAttempts = action.payload;
    },
    incrementReconnectAttempts: (state) => {
      state.reconnectAttempts += 1;
    },
    resetReconnectAttempts: (state) => {
      state.reconnectAttempts = 0;
    },
    setLatency: (state, action: PayloadAction<number>) => {
      state.latency = action.payload;
    },
    resetConnection: () => initialState,
  },
});

export const {
  setStatus, setConnectionInfo, setConnectedDeviceIp,
  addDiscoveredDevice, removeDiscoveredDevice, clearDiscoveredDevices,
  setClientCount, incrementClientCount, decrementClientCount,
  setIsScanning, setScanError, setEnteredCode, setManualHost,
  setReconnectAttempts, incrementReconnectAttempts, resetReconnectAttempts,
  setLatency, resetConnection,
} = connectionSlice.actions;

export default connectionSlice.reducer;
