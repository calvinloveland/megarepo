/**
 * App.tsx Tests
 * 
 * Tests that the app renders correctly and handles various states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

// Mock the stores
vi.mock('../store', () => ({
  useClusterStore: () => ({
    connected: false,
    peerState: 'connecting',
    setConnected: vi.fn(),
    setPeerId: vi.fn(),
    setPeerState: vi.fn(),
    setClusterStats: vi.fn(),
    setLayerAssignment: vi.fn(),
    layerAssignment: null,
  }),
  useChatStore: () => ({
    messages: [],
    generation: { status: 'idle', currentPrompt: null, tokensGenerated: 0, startTime: null },
    addMessage: vi.fn(),
    updateLastMessage: vi.fn(),
    setActiveModel: vi.fn(),
    setGeneration: vi.fn(),
  }),
  useHardwareStore: () => ({
    modelLoaded: false,
    setWebGPU: vi.fn(),
    setModelLoaded: vi.fn(),
    setModelLoadProgress: vi.fn(),
  }),
}));

// Mock the network modules
vi.mock('../network/coordinator', () => ({
  coordinator: {
    connect: vi.fn().mockResolvedValue('test-peer-id'),
    disconnect: vi.fn(),
    reportCapabilities: vi.fn(),
    updateState: vi.fn(),
    sendHeartbeat: vi.fn(),
    onWelcome: vi.fn(),
    onLayerAssignment: vi.fn(),
    onClusterUpdate: vi.fn(),
    onModelChange: vi.fn(),
    onWebRTCSignal: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    isConnected: false,
    currentPeerId: null,
  },
}));

vi.mock('../network/peers', () => ({
  peerMesh: {
    initialize: vi.fn(),
    onHiddenState: vi.fn(),
    onRequestHiddenState: vi.fn(),
    disconnectAll: vi.fn(),
    connectToPeer: vi.fn(),
    sendHiddenState: vi.fn(),
    requestHiddenState: vi.fn(),
  },
}));

vi.mock('../inference/engine', () => ({
  inferenceEngine: {
    loadModel: vi.fn().mockResolvedValue(undefined),
    generate: vi.fn(),
    getCurrentModelId: vi.fn(),
  },
}));

vi.mock('../inference/webgpu', () => ({
  detectWebGPU: vi.fn().mockResolvedValue({
    supported: true,
    adapter: { vendor: 'Test', architecture: 'test', device: 'GPU', description: 'Test' },
    limits: {},
    estimatedVRAM: 4,
  }),
  meetsMinimumRequirements: vi.fn().mockReturnValue({ meets: true }),
}));

vi.mock('../utils/errorLogger', () => ({
  initializeErrorLogger: vi.fn().mockReturnValue({
    log: vi.fn(),
    logMessage: vi.fn(),
    flush: vi.fn(),
    destroy: vi.fn(),
  }),
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', async () => {
    render(<App />);
    
    // Should show the app header
    expect(screen.getByText('HiveMind')).toBeInTheDocument();
  });

  it('should render the header with logo', async () => {
    render(<App />);
    
    // Header should be visible
    const header = screen.getByRole('banner');
    expect(header).toBeInTheDocument();
  });

  it('should show input placeholder for connecting state', async () => {
    render(<App />);
    
    // Should show connecting message in placeholder
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Connecting to HiveMind...');
  });

  it('should render chat input', async () => {
    render(<App />);
    
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
  });

  it('should have disabled input when not connected', async () => {
    render(<App />);
    
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });
});
