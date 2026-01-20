/**
 * Vitest setup file
 * Configures testing environment and global mocks
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock WebGPU API
const mockGPU = {
  requestAdapter: vi.fn().mockResolvedValue({
    info: {
      vendor: 'Test Vendor',
      architecture: 'test-arch',
      device: 'Test GPU',
      description: 'Test GPU Description',
    },
    limits: {
      maxBufferSize: 1073741824,
    },
  }),
};

// @ts-expect-error - mocking navigator.gpu
globalThis.navigator.gpu = mockGPU;

// Mock crypto.randomUUID
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
});

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

// Mock Socket.IO
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  })),
}));

// Mock the coordinator singleton
vi.mock('../network/coordinator', () => ({
  coordinator: {
    connect: vi.fn().mockResolvedValue('test-peer-id'),
    disconnect: vi.fn(),
    onWelcome: vi.fn(),
    onLayerAssignment: vi.fn(),
    onClusterUpdate: vi.fn(),
    onModelChange: vi.fn(),
    onWebRTCSignal: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    reportCapabilities: vi.fn(),
    updateState: vi.fn(),
    sendHeartbeat: vi.fn(),
    sendWebRTCSignal: vi.fn(),
    reportInferenceComplete: vi.fn(),
    isConnected: false,
    currentPeerId: null,
  },
}));

// Mock WebLLM
vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: vi.fn().mockResolvedValue({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test response' } }],
        }),
      },
    },
  }),
}));

// Mock import.meta.env
vi.stubEnv('VITE_COORDINATOR_URL', 'http://localhost:5000');

// Suppress console during tests unless needed
const originalConsoleError = console.error;
console.error = (...args) => {
  // Only log unexpected errors
  if (args[0]?.includes?.('Warning:')) return;
  originalConsoleError(...args);
};
