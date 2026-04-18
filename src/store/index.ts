// src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import appReducer from './slices/appSlice';
import connectionReducer from './slices/connectionSlice';
import streamReducer from './slices/streamSlice';

export const store = configureStore({
  reducer: {
    app: appReducer,
    connection: connectionReducer,
    stream: streamReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['stream/setLatestFrame'],
        ignoredPaths: ['stream.latestFrame'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
