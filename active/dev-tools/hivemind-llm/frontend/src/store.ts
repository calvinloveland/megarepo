/**
 * Global state store using Zustand
 */

import { create } from 'zustand';
import type {
  PeerState,
  ClusterStats,
  LayerAssignment,
  ChatMessage,
  GenerationProgress,
  WebGPUInfo,
  ModelInfo,
} from './types';

// ==================== Cluster Store ====================

interface ClusterState {
  // Connection state
  connected: boolean;
  peerId: string | null;
  peerState: PeerState;
  
  // Cluster info
  clusterStats: ClusterStats | null;
  layerAssignment: LayerAssignment | null;
  
  // Actions
  setConnected: (connected: boolean) => void;
  setPeerId: (peerId: string) => void;
  setPeerState: (state: PeerState) => void;
  setClusterStats: (stats: ClusterStats) => void;
  setLayerAssignment: (assignment: LayerAssignment | null) => void;
}

export const useClusterStore = create<ClusterState>((set) => ({
  connected: false,
  peerId: null,
  peerState: 'connecting',
  clusterStats: null,
  layerAssignment: null,
  
  setConnected: (connected) => set({ connected }),
  setPeerId: (peerId) => set({ peerId }),
  setPeerState: (peerState) => set({ peerState }),
  setClusterStats: (clusterStats) => set({ clusterStats }),
  setLayerAssignment: (layerAssignment) => set({ layerAssignment }),
}));

// ==================== Chat Store ====================

interface ChatState {
  messages: ChatMessage[];
  activeModel: ModelInfo | null;
  generation: GenerationProgress;
  
  // Actions
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;
  setActiveModel: (model: ModelInfo | null) => void;
  setGeneration: (progress: Partial<GenerationProgress>) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  activeModel: null,
  generation: {
    status: 'idle',
    tokens_generated: 0,
    tokens_per_second: 0,
  },
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),
  
  updateLastMessage: (content) => set((state) => {
    const messages = [...state.messages];
    if (messages.length > 0) {
      messages[messages.length - 1] = {
        ...messages[messages.length - 1],
        content,
      };
    }
    return { messages };
  }),
  
  clearMessages: () => set({ messages: [] }),
  
  setActiveModel: (activeModel) => set({ activeModel }),
  
  setGeneration: (progress) => set((state) => ({
    generation: { ...state.generation, ...progress },
  })),
}));

// ==================== Hardware Store ====================

interface HardwareState {
  webgpu: WebGPUInfo | null;
  modelLoaded: boolean;
  modelLoadProgress: number;
  
  // Actions
  setWebGPU: (info: WebGPUInfo) => void;
  setModelLoaded: (loaded: boolean) => void;
  setModelLoadProgress: (progress: number) => void;
}

export const useHardwareStore = create<HardwareState>((set) => ({
  webgpu: null,
  modelLoaded: false,
  modelLoadProgress: 0,
  
  setWebGPU: (webgpu) => set({ webgpu }),
  setModelLoaded: (modelLoaded) => set({ modelLoaded }),
  setModelLoadProgress: (modelLoadProgress) => set({ modelLoadProgress }),
}));
