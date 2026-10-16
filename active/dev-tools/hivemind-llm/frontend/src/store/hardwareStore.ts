/**
 * Hardware State Store - Zustand store for WebGPU and model loading state
 */

import { create } from 'zustand';
import type { BackendKind, WebGPUInfo } from '../types';

interface HardwareState {
  // WebGPU capabilities
  webGPU: WebGPUInfo | null;

  // Active inference backend
  backend: BackendKind | null;
  backendReason: string | null;
  
  // Model loading
  modelLoaded: boolean;
  modelLoadProgress: number; // 0-100
  
  // Actions
  setWebGPU: (info: WebGPUInfo | null) => void;
  setBackend: (backend: BackendKind | null, reason?: string | null) => void;
  setModelLoaded: (loaded: boolean) => void;
  setModelLoadProgress: (progress: number) => void;
}

export const useHardwareStore = create<HardwareState>((set) => ({
  // Initial state
  webGPU: null,
  backend: null,
  backendReason: null,
  modelLoaded: false,
  modelLoadProgress: 0,
  
  // Actions
  setWebGPU: (webGPU) => set({ webGPU }),
  setBackend: (backend, backendReason = null) => set({ backend, backendReason }),
  setModelLoaded: (modelLoaded) => set({ modelLoaded }),
  setModelLoadProgress: (modelLoadProgress) => set({ modelLoadProgress }),
}));
