/**
 * Cluster State Store - Zustand store for cluster connection state
 */

import { create } from 'zustand';
import type { PeerState, LayerAssignment, ClusterStats } from '../types';

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
  setPeerId: (id: string | null) => void;
  setPeerState: (state: PeerState) => void;
  setClusterStats: (stats: ClusterStats | null) => void;
  setLayerAssignment: (assignment: LayerAssignment | null) => void;
}

export const useClusterStore = create<ClusterState>((set) => ({
  // Initial state
  connected: false,
  peerId: null,
  peerState: 'connecting',
  clusterStats: null,
  layerAssignment: null,
  
  // Actions
  setConnected: (connected) => set({ connected }),
  setPeerId: (peerId) => set({ peerId }),
  setPeerState: (peerState) => set({ peerState }),
  setClusterStats: (clusterStats) => set({ clusterStats }),
  setLayerAssignment: (layerAssignment) => set({ layerAssignment }),
}));
