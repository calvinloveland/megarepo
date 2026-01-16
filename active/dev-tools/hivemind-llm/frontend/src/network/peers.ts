/**
 * WebRTC peer mesh for direct peer-to-peer communication
 */

import SimplePeer, { SignalData } from 'simple-peer';
import { coordinator } from './coordinator';
import type { WebRTCSignalEvent } from '../types';

interface PeerConnection {
  peer: SimplePeer.Instance;
  peerId: string;
  connected: boolean;
}

type DataHandler = (peerId: string, data: ArrayBuffer) => void;

export class PeerMesh {
  private connections: Map<string, PeerConnection> = new Map();
  private dataHandlers: DataHandler[] = [];
  private localPeerId: string | null = null;

  constructor() {
    // Listen for WebRTC signals from coordinator
    coordinator.onWebRTCSignal(this.handleSignal.bind(this));
  }

  /**
   * Initialize the mesh with our peer ID
   */
  initialize(peerId: string): void {
    this.localPeerId = peerId;
  }

  /**
   * Connect to a list of peers
   */
  async connectToPeers(peerIds: string[]): Promise<void> {
    for (const peerId of peerIds) {
      if (peerId !== this.localPeerId && !this.connections.has(peerId)) {
        await this.createConnection(peerId, true);
      }
    }
  }

  /**
   * Create a WebRTC connection to a peer
   */
  private async createConnection(
    peerId: string,
    initiator: boolean
  ): Promise<PeerConnection> {
    console.log(`Creating ${initiator ? 'initiator' : 'receiver'} connection to ${peerId}`);

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    const connection: PeerConnection = {
      peer,
      peerId,
      connected: false,
    };

    // Handle signaling data
    peer.on('signal', (signal: SignalData) => {
      coordinator.sendWebRTCSignal(peerId, signal as unknown as RTCSessionDescriptionInit);
    });

    // Connection established
    peer.on('connect', () => {
      console.log(`Connected to peer ${peerId}`);
      connection.connected = true;
    });

    // Receive data
    peer.on('data', (data: ArrayBuffer) => {
      this.dataHandlers.forEach((handler) => handler(peerId, data));
    });

    // Handle errors
    peer.on('error', (err) => {
      console.error(`Peer ${peerId} error:`, err);
      this.connections.delete(peerId);
    });

    // Handle close
    peer.on('close', () => {
      console.log(`Connection to ${peerId} closed`);
      this.connections.delete(peerId);
    });

    this.connections.set(peerId, connection);
    return connection;
  }

  /**
   * Handle incoming WebRTC signal from coordinator
   */
  private async handleSignal(event: WebRTCSignalEvent): Promise<void> {
    const { from_peer, signal } = event;

    let connection = this.connections.get(from_peer);

    // Create connection if it doesn't exist (we're the receiver)
    if (!connection) {
      connection = await this.createConnection(from_peer, false);
    }

    // Pass signal to peer
    connection.peer.signal(signal as unknown as SignalData);
  }

  /**
   * Send data to a specific peer
   */
  send(peerId: string, data: ArrayBuffer): boolean {
    const connection = this.connections.get(peerId);
    if (!connection || !connection.connected) {
      console.warn(`Cannot send to ${peerId}: not connected`);
      return false;
    }

    try {
      connection.peer.send(data);
      return true;
    } catch (err) {
      console.error(`Error sending to ${peerId}:`, err);
      return false;
    }
  }

  /**
   * Send data to the next peer in the pipeline
   */
  sendToNext(peerOrder: string[], data: ArrayBuffer): boolean {
    if (!this.localPeerId) return false;

    const myIndex = peerOrder.indexOf(this.localPeerId);
    if (myIndex === -1 || myIndex === peerOrder.length - 1) {
      // We're the last peer or not in the pipeline
      return false;
    }

    const nextPeerId = peerOrder[myIndex + 1];
    return this.send(nextPeerId, data);
  }

  /**
   * Register a handler for incoming data
   */
  onData(handler: DataHandler): void {
    this.dataHandlers.push(handler);
  }

  /**
   * Check if connected to a specific peer
   */
  isConnectedTo(peerId: string): boolean {
    const connection = this.connections.get(peerId);
    return connection?.connected ?? false;
  }

  /**
   * Get list of connected peer IDs
   */
  getConnectedPeers(): string[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.connected)
      .map(([id]) => id);
  }

  /**
   * Disconnect from all peers
   */
  disconnectAll(): void {
    for (const [peerId, connection] of this.connections) {
      try {
        connection.peer.destroy();
      } catch (err) {
        console.error(`Error destroying connection to ${peerId}:`, err);
      }
    }
    this.connections.clear();
  }
}

// Singleton instance
export const peerMesh = new PeerMesh();
