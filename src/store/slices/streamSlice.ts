// src/store/slices/streamSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface StreamState {
  isStreaming: boolean;
  frameCount: number;
  fps: number;
  latestFrameUri: string | null;
  remoteWidth: number;
  remoteHeight: number;
  remoteDeviceName: string;
  quality: 'low' | 'medium' | 'high';
  showControls: boolean;
  isFullscreen: boolean;
  bytesReceived: number;
  avgFrameSize: number;
}

const initialState: StreamState = {
  isStreaming: false,
  frameCount: 0,
  fps: 0,
  latestFrameUri: null,
  remoteWidth: 0,
  remoteHeight: 0,
  remoteDeviceName: '',
  quality: 'medium',
  showControls: true,
  isFullscreen: false,
  bytesReceived: 0,
  avgFrameSize: 0,
};

const streamSlice = createSlice({
  name: 'stream',
  initialState,
  reducers: {
    setIsStreaming: (state, action: PayloadAction<boolean>) => {
      state.isStreaming = action.payload;
    },
    setLatestFrame: (state, action: PayloadAction<string>) => {
      state.latestFrameUri = action.payload;
      state.frameCount += 1;
    },
    setFps: (state, action: PayloadAction<number>) => {
      state.fps = action.payload;
    },
    setRemoteDevice: (state, action: PayloadAction<{
      width: number; height: number; deviceName: string;
    }>) => {
      state.remoteWidth = action.payload.width;
      state.remoteHeight = action.payload.height;
      state.remoteDeviceName = action.payload.deviceName;
    },
    setQuality: (state, action: PayloadAction<'low' | 'medium' | 'high'>) => {
      state.quality = action.payload;
    },
    setShowControls: (state, action: PayloadAction<boolean>) => {
      state.showControls = action.payload;
    },
    setIsFullscreen: (state, action: PayloadAction<boolean>) => {
      state.isFullscreen = action.payload;
    },
    addBytes: (state, action: PayloadAction<number>) => {
      state.bytesReceived += action.payload;
      state.avgFrameSize = state.bytesReceived / Math.max(1, state.frameCount);
    },
    resetStream: () => initialState,
  },
});

export const {
  setIsStreaming, setLatestFrame, setFps, setRemoteDevice,
  setQuality, setShowControls, setIsFullscreen, addBytes, resetStream,
} = streamSlice.actions;

export default streamSlice.reducer;
