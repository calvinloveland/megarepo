/**
 * Hardware State Store - Zustand store for WebGPU and model loading state
 */

import { create } from 'zustand';
import type { WebGPUInfo } from '../types';

interface HardwareState {
  // WebGPU capabilities
  webGPU: WebGPUInfo | null;
  
  // Model loading
  modelLoaded: boolean;
  modelLoadProgress: number; // 0-100
  
  // Actions
  setWebGPU: (info: WebGPUInfo | null) => void;
  setModelLoaded: (loaded: boolean) => void;
  setModelLoadProgress: (progress: number) => void;
}

export const useHardwareStore = create<HardwareState>((set) => ({
  // Initial state
  webGPU: null,
  modelLoaded: false,
  modelLoadProgress: 0,
  
  // Actions
  setWebGPU: (webGPU) => set({ webGPU }),
  setModelLoaded: (modelLoaded) => set({ modelLoaded }),
  setModelLoadProgress: (modelLoadProgress) => set({ modelLoadProgress }),
}));
