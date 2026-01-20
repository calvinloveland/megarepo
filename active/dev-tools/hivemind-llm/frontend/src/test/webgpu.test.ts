/**
 * WebGPU Detection Tests
 * 
 * Tests for WebGPU capability detection and requirements checking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectWebGPU, meetsMinimumRequirements } from '../inference/webgpu';
import type { WebGPUInfo } from '../types';

describe('detectWebGPU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect WebGPU when available', async () => {
    const result = await detectWebGPU();
    
    // Our mock returns supported: true
    expect(result.supported).toBe(true);
    expect(result.adapter).toBeDefined();
  });

  it('should return supported=false when WebGPU is unavailable', async () => {
    // Temporarily remove GPU mock
    const originalGPU = globalThis.navigator.gpu;
    // @ts-expect-error - removing for test
    delete globalThis.navigator.gpu;
    
    const result = await detectWebGPU();
    
    expect(result.supported).toBe(false);
    expect(result.adapter).toBeNull();
    
    // Restore mock
    // @ts-expect-error - restoring mock
    globalThis.navigator.gpu = originalGPU;
  });

  it('should handle adapter request failure', async () => {
    const originalGPU = globalThis.navigator.gpu;
    // @ts-expect-error - mock returning null
    globalThis.navigator.gpu = {
      requestAdapter: vi.fn().mockResolvedValue(null),
    };
    
    const result = await detectWebGPU();
    
    expect(result.supported).toBe(false);
    
    // @ts-expect-error - restoring
    globalThis.navigator.gpu = originalGPU;
  });
});

describe('meetsMinimumRequirements', () => {
  it('should pass when WebGPU is supported with enough VRAM', () => {
    const gpuInfo: WebGPUInfo = {
      supported: true,
      adapter: { vendor: 'Test', architecture: 'test', device: 'GPU', description: '' },
      limits: null,
      estimatedVRAM: 4,
    };
    
    const result = meetsMinimumRequirements(gpuInfo);
    
    expect(result.meets).toBe(true);
  });

  it('should fail when WebGPU is not supported', () => {
    const gpuInfo: WebGPUInfo = {
      supported: false,
      adapter: null,
      limits: null,
      estimatedVRAM: 0,
    };
    
    const result = meetsMinimumRequirements(gpuInfo);
    
    expect(result.meets).toBe(false);
    expect(result.reason).toContain('WebGPU');
  });

  it('should fail when VRAM is too low', () => {
    const gpuInfo: WebGPUInfo = {
      supported: true,
      adapter: { vendor: 'Test', architecture: 'test', device: 'GPU', description: '' },
      limits: null,
      estimatedVRAM: 0.4, // Below 0.5 threshold
    };
    
    const result = meetsMinimumRequirements(gpuInfo);
    
    expect(result.meets).toBe(false);
    expect(result.reason).toContain('memory');
  });
});
