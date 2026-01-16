/**
 * Store Tests
 * 
 * Tests for Zustand stores to ensure state management works correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useClusterStore } from '../store/clusterStore';
import { useChatStore } from '../store/chatStore';
import { useHardwareStore } from '../store/hardwareStore';

describe('useClusterStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useClusterStore.setState({
      connected: false,
      peerId: null,
      peerState: 'connecting',
      clusterStats: null,
      layerAssignment: null,
    });
  });

  it('should have correct initial state', () => {
    const state = useClusterStore.getState();
    
    expect(state.connected).toBe(false);
    expect(state.peerId).toBeNull();
    expect(state.peerState).toBe('connecting');
    expect(state.clusterStats).toBeNull();
    expect(state.layerAssignment).toBeNull();
  });

  it('should set connected state', () => {
    const { setConnected } = useClusterStore.getState();
    
    act(() => setConnected(true));
    
    expect(useClusterStore.getState().connected).toBe(true);
  });

  it('should set peer ID', () => {
    const { setPeerId } = useClusterStore.getState();
    
    act(() => setPeerId('test-peer-123'));
    
    expect(useClusterStore.getState().peerId).toBe('test-peer-123');
  });

  it('should set peer state', () => {
    const { setPeerState } = useClusterStore.getState();
    
    act(() => setPeerState('ready'));
    
    expect(useClusterStore.getState().peerState).toBe('ready');
  });
});

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      activeModel: null,
      generation: {
        status: 'idle',
        currentPrompt: null,
        tokensGenerated: 0,
        startTime: null,
      },
    });
  });

  it('should have correct initial state', () => {
    const state = useChatStore.getState();
    
    expect(state.messages).toEqual([]);
    expect(state.activeModel).toBeNull();
    expect(state.generation.status).toBe('idle');
  });

  it('should add a message', () => {
    const { addMessage } = useChatStore.getState();
    const message = {
      id: 'test-1',
      role: 'user' as const,
      content: 'Hello',
      timestamp: new Date(),
    };
    
    act(() => addMessage(message));
    
    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe('Hello');
  });

  it('should update last message', () => {
    const { addMessage, updateLastMessage } = useChatStore.getState();
    
    act(() => {
      addMessage({
        id: 'test-1',
        role: 'assistant' as const,
        content: 'Initial',
        timestamp: new Date(),
      });
    });
    
    act(() => updateLastMessage('Updated content'));
    
    const state = useChatStore.getState();
    expect(state.messages[0].content).toBe('Updated content');
  });

  it('should clear messages', () => {
    const { addMessage, clearMessages } = useChatStore.getState();
    
    act(() => {
      addMessage({ id: '1', role: 'user' as const, content: 'A', timestamp: new Date() });
      addMessage({ id: '2', role: 'assistant' as const, content: 'B', timestamp: new Date() });
    });
    
    expect(useChatStore.getState().messages).toHaveLength(2);
    
    act(() => clearMessages());
    
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it('should set generation status', () => {
    const { setGeneration } = useChatStore.getState();
    
    act(() => setGeneration({ status: 'generating' }));
    
    expect(useChatStore.getState().generation.status).toBe('generating');
  });
});

describe('useHardwareStore', () => {
  beforeEach(() => {
    useHardwareStore.setState({
      webGPU: null,
      modelLoaded: false,
      modelLoadProgress: 0,
    });
  });

  it('should have correct initial state', () => {
    const state = useHardwareStore.getState();
    
    expect(state.webGPU).toBeNull();
    expect(state.modelLoaded).toBe(false);
    expect(state.modelLoadProgress).toBe(0);
  });

  it('should set WebGPU info', () => {
    const { setWebGPU } = useHardwareStore.getState();
    const gpuInfo = {
      supported: true,
      adapter: { vendor: 'NVIDIA', architecture: 'Ampere', device: 'RTX', description: '' },
      limits: null,
      estimatedVRAM: 8,
    };
    
    act(() => setWebGPU(gpuInfo));
    
    const state = useHardwareStore.getState();
    expect(state.webGPU?.supported).toBe(true);
    expect(state.webGPU?.estimatedVRAM).toBe(8);
  });

  it('should set model loaded state', () => {
    const { setModelLoaded } = useHardwareStore.getState();
    
    act(() => setModelLoaded(true));
    
    expect(useHardwareStore.getState().modelLoaded).toBe(true);
  });

  it('should track model load progress', () => {
    const { setModelLoadProgress } = useHardwareStore.getState();
    
    act(() => setModelLoadProgress(50));
    expect(useHardwareStore.getState().modelLoadProgress).toBe(50);
    
    act(() => setModelLoadProgress(100));
    expect(useHardwareStore.getState().modelLoadProgress).toBe(100);
  });
});
