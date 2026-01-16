/**
 * WebSocket connection to the coordinator server
 */

import { io, Socket } from 'socket.io-client';
import type {
  PeerCapabilities,
  WelcomeEvent,
  LayerAssignmentEvent,
  ClusterUpdateEvent,
  ModelChangeEvent,
  WebRTCSignalEvent,
  PeerState,
} from '../types';

type EventCallback<T> = (data: T) => void;

export class CoordinatorConnection {
  private socket: Socket | null = null;
  private peerId: string | null = null;
  private connected = false;

  // Event handlers
  private onWelcomeHandlers: EventCallback<WelcomeEvent>[] = [];
  private onLayerAssignmentHandlers: EventCallback<LayerAssignmentEvent>[] = [];
  private onClusterUpdateHandlers: EventCallback<ClusterUpdateEvent>[] = [];
  private onModelChangeHandlers: EventCallback<ModelChangeEvent>[] = [];
  private onWebRTCSignalHandlers: EventCallback<WebRTCSignalEvent>[] = [];
  private onDisconnectHandlers: EventCallback<void>[] = [];
  private onErrorHandlers: EventCallback<{ message: string }>[] = [];

  /**
   * Connect to the coordinator server
   */
  connect(url: string = ''): Promise<string> {
    return new Promise((resolve, reject) => {
      // Use relative URL if not specified (for same-origin deployment)
      const socketUrl = url || window.location.origin;
      
      this.socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      // Connection established
      this.socket.on('connect', () => {
        console.log('Connected to coordinator');
        this.connected = true;
      });

      // Welcome message with peer ID
      this.socket.on('welcome', (data: WelcomeEvent) => {
        this.peerId = data.peer_id;
        console.log('Assigned peer ID:', this.peerId);
        this.onWelcomeHandlers.forEach((h) => h(data));
        resolve(this.peerId);
      });

      // Layer assignment
      this.socket.on('layer_assignment', (data: LayerAssignmentEvent) => {
        console.log('Layer assignment:', data);
        this.onLayerAssignmentHandlers.forEach((h) => h(data));
      });

      // Cluster updates
      this.socket.on('cluster_update', (data: ClusterUpdateEvent) => {
        this.onClusterUpdateHandlers.forEach((h) => h(data));
      });

      // Model change
      this.socket.on('model_change', (data: ModelChangeEvent) => {
        console.log('Model change:', data);
        this.onModelChangeHandlers.forEach((h) => h(data));
      });

      // WebRTC signaling
      this.socket.on('webrtc_signal', (data: WebRTCSignalEvent) => {
        this.onWebRTCSignalHandlers.forEach((h) => h(data));
      });

      // Heartbeat acknowledgment
      this.socket.on('heartbeat_ack', () => {
        // Connection is alive
      });

      // Error
      this.socket.on('error', (data: { message: string }) => {
        console.error('Coordinator error:', data.message);
        this.onErrorHandlers.forEach((h) => h(data));
      });

      // Disconnection
      this.socket.on('disconnect', (reason) => {
        console.log('Disconnected from coordinator:', reason);
        this.connected = false;
        this.onDisconnectHandlers.forEach((h) => h());
      });

      // Connection error
      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        reject(error);
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Disconnect from the coordinator
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.peerId = null;
    }
  }

  /**
   * Report peer capabilities to the coordinator
   */
  reportCapabilities(capabilities: PeerCapabilities): void {
    if (!this.socket || !this.connected) {
      console.warn('Cannot report capabilities: not connected');
      return;
    }
    this.socket.emit('report_capabilities', capabilities);
  }

  /**
   * Update peer state
   */
  updateState(state: PeerState): void {
    if (!this.socket || !this.connected) return;
    this.socket.emit('state_update', { state });
  }

  /**
   * Send heartbeat to keep connection alive
   */
  sendHeartbeat(): void {
    if (!this.socket || !this.connected) return;
    this.socket.emit('heartbeat');
  }

  /**
   * Send WebRTC signal to another peer (relayed through coordinator)
   */
  sendWebRTCSignal(
    targetPeer: string,
    signal: RTCSessionDescriptionInit | RTCIceCandidateInit
  ): void {
    if (!this.socket || !this.connected) return;
    this.socket.emit('webrtc_signal', {
      target_peer: targetPeer,
      signal,
    });
  }

  /**
   * Report inference completion
   */
  reportInferenceComplete(tokensGenerated: number): void {
    if (!this.socket || !this.connected) return;
    this.socket.emit('inference_complete', {
      tokens_generated: tokensGenerated,
    });
  }

  // ==================== Event Registration ====================

  onWelcome(callback: EventCallback<WelcomeEvent>): void {
    this.onWelcomeHandlers.push(callback);
  }

  onLayerAssignment(callback: EventCallback<LayerAssignmentEvent>): void {
    this.onLayerAssignmentHandlers.push(callback);
  }

  onClusterUpdate(callback: EventCallback<ClusterUpdateEvent>): void {
    this.onClusterUpdateHandlers.push(callback);
  }

  onModelChange(callback: EventCallback<ModelChangeEvent>): void {
    this.onModelChangeHandlers.push(callback);
  }

  onWebRTCSignal(callback: EventCallback<WebRTCSignalEvent>): void {
    this.onWebRTCSignalHandlers.push(callback);
  }

  onDisconnect(callback: EventCallback<void>): void {
    this.onDisconnectHandlers.push(callback);
  }

  onError(callback: EventCallback<{ message: string }>): void {
    this.onErrorHandlers.push(callback);
  }

  // ==================== Getters ====================

  get isConnected(): boolean {
    return this.connected;
  }

  get currentPeerId(): string | null {
    return this.peerId;
  }
}

// Singleton instance
export const coordinator = new CoordinatorConnection();
