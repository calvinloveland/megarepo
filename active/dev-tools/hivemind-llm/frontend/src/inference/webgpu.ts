/**
 * WebGPU capability detection
 */

import type { WebGPUInfo, GPUAdapterInfoCustom } from '../types';

// Extend Navigator for WebGPU
declare global {
  interface Navigator {
    gpu?: GPU;
  }
}

/**
 * Detect WebGPU capabilities and estimate available VRAM
 */
export async function detectWebGPU(): Promise<WebGPUInfo> {
  // Check if WebGPU is supported
  if (!navigator.gpu) {
    return {
      supported: false,
      adapter: null,
      limits: null,
      estimatedVRAM: 0,
    };
  }

  try {
    // Request adapter
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      return {
        supported: false,
        adapter: null,
        limits: null,
        estimatedVRAM: 0,
      };
    }

    // Get adapter info - use 'info' property (standard) which is sync
    const adapterInfo = adapter.info;
    const limits = adapter.limits;

    // Estimate VRAM based on max buffer size
    // This is a rough estimate - WebGPU doesn't expose actual VRAM
    const maxBufferSize = limits.maxBufferSize;
    const estimatedVRAM = estimateVRAM(maxBufferSize, {
      vendor: adapterInfo.vendor || 'Unknown',
      architecture: adapterInfo.architecture || 'Unknown',
      device: adapterInfo.device || 'Unknown',
      description: adapterInfo.description || 'Unknown GPU',
    });

    return {
      supported: true,
      adapter: {
        vendor: adapterInfo.vendor || 'Unknown',
        architecture: adapterInfo.architecture || 'Unknown',
        device: adapterInfo.device || 'Unknown',
        description: adapterInfo.description || 'Unknown GPU',
      },
      limits: null, // Skip limits to avoid type issues
      estimatedVRAM,
    };
  } catch (error) {
    console.error('WebGPU detection error:', error);
    return {
      supported: false,
      adapter: null,
      limits: null,
      estimatedVRAM: 0,
    };
  }
}

/**
 * Estimate available VRAM based on adapter info and limits
 */
function estimateVRAM(maxBufferSize: number, adapterInfo: GPUAdapterInfoCustom): number {
  // Base estimate from max buffer size (usually 1/4 to 1/2 of VRAM)
  let estimate = maxBufferSize / (1024 * 1024 * 1024) * 2; // Convert to GB and multiply

  // Adjust based on known GPU vendors/devices
  const vendor = adapterInfo.vendor?.toLowerCase() || '';
  const device = adapterInfo.device?.toLowerCase() || '';
  const description = adapterInfo.description?.toLowerCase() || '';

  // NVIDIA GPUs
  if (vendor.includes('nvidia') || description.includes('nvidia')) {
    if (device.includes('4090') || description.includes('4090')) {
      estimate = Math.min(estimate, 24);
    } else if (device.includes('4080') || description.includes('4080')) {
      estimate = Math.min(estimate, 16);
    } else if (device.includes('4070') || description.includes('4070')) {
      estimate = Math.min(estimate, 12);
    } else if (device.includes('3090') || description.includes('3090')) {
      estimate = Math.min(estimate, 24);
    } else if (device.includes('3080') || description.includes('3080')) {
      estimate = Math.min(estimate, 12);
    } else if (device.includes('3070') || description.includes('3070')) {
      estimate = Math.min(estimate, 8);
    }
  }

  // AMD GPUs
  if (vendor.includes('amd') || description.includes('amd') || description.includes('radeon')) {
    if (device.includes('7900') || description.includes('7900')) {
      estimate = Math.min(estimate, 20);
    } else if (device.includes('7800') || description.includes('7800')) {
      estimate = Math.min(estimate, 16);
    } else if (device.includes('6900') || description.includes('6900')) {
      estimate = Math.min(estimate, 16);
    }
  }

  // Apple Silicon
  if (vendor.includes('apple') || description.includes('apple')) {
    // M1/M2/M3 share memory with system
    // Conservatively estimate 1/4 of typical unified memory
    if (description.includes('m3 max')) {
      estimate = Math.min(estimate, 32);
    } else if (description.includes('m3 pro') || description.includes('m2 max')) {
      estimate = Math.min(estimate, 24);
    } else if (description.includes('m3') || description.includes('m2 pro')) {
      estimate = Math.min(estimate, 12);
    } else if (description.includes('m2') || description.includes('m1 pro')) {
      estimate = Math.min(estimate, 8);
    } else {
      estimate = Math.min(estimate, 4);
    }
  }

  // Intel GPUs (integrated)
  if (vendor.includes('intel')) {
    estimate = Math.min(estimate, 2);
  }

  // Clamp to reasonable bounds
  return Math.max(0.5, Math.min(estimate, 48));
}

/**
 * Get a human-readable description of the GPU
 */
export function getGPUDescription(info: WebGPUInfo): string {
  if (!info.supported || !info.adapter) {
    return 'WebGPU not available';
  }

  const { adapter, estimatedVRAM } = info;
  const parts = [adapter.description || adapter.device || 'Unknown GPU'];
  
  if (estimatedVRAM > 0) {
    parts.push(`~${estimatedVRAM.toFixed(1)}GB VRAM`);
  }

  return parts.join(' • ');
}

/**
 * Check if the device meets minimum requirements
 */
export function meetsMinimumRequirements(info: WebGPUInfo): {
  meets: boolean;
  reason?: string;
} {
  if (!info.supported) {
    return {
      meets: false,
      reason: 'WebGPU is not supported in your browser. Try Chrome 113+ or Edge 113+.',
    };
  }

  if (info.estimatedVRAM < 0.5) {
    return {
      meets: false,
      reason: 'Insufficient GPU memory. At least 0.5GB VRAM is required.',
    };
  }

  return { meets: true };
}
