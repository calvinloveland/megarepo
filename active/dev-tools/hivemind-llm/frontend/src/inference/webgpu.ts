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

/** Coerce adapter info fields to non-null GPUAdapterInfoCustom. */
function toAdapterInfoCustom(info: GPUAdapterInfo): GPUAdapterInfoCustom {
  const or = (v: string | undefined | null, fb: string) => (v ? v : fb);
  return {
    vendor: or(info.vendor, 'Unknown'),
    architecture: or(info.architecture, 'Unknown'),
    device: or(info.device, 'Unknown'),
    description: or(info.description, 'Unknown GPU'),
  };
}

/**
 * Detect WebGPU capabilities and estimate available VRAM
 */
export async function detectWebGPU(): Promise<WebGPUInfo> {
  if (!navigator.gpu) {
    return { supported: false, adapter: null, limits: null, estimatedVRAM: 0 };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      return { supported: false, adapter: null, limits: null, estimatedVRAM: 0 };
    }

    const adapterInfo = adapter.info;
    const limits = adapter.limits;
    const customInfo = toAdapterInfoCustom(adapterInfo);
    const estimatedVRAM = estimateVRAM(limits.maxBufferSize, customInfo);

    return {
      supported: true,
      adapter: customInfo,
      limits: null,
      estimatedVRAM,
    };
  } catch (error) {
    console.error('WebGPU detection error:', error);
    return { supported: false, adapter: null, limits: null, estimatedVRAM: 0 };
  }
}

// ---------------------------------------------------------------------------
// VRAM estimation via vendor/model lookup table
// ---------------------------------------------------------------------------

interface VramRule {
  modelPattern: string;
  vramGb: number;
}

interface VendorVramConfig {
  /** Substrings that identify this vendor (matched against vendor/description). */
  keywords: string[];
  /** Ordered model rules; first matching pattern wins. */
  models: VramRule[];
  /** Fallback cap when no model pattern matches. Omit for no cap. */
  fallbackGb?: number;
}

const VRAM_TABLE: VendorVramConfig[] = [
  {
    keywords: ['nvidia'],
    models: [
      { modelPattern: '4090', vramGb: 24 },
      { modelPattern: '4080', vramGb: 16 },
      { modelPattern: '4070', vramGb: 12 },
      { modelPattern: '3090', vramGb: 24 },
      { modelPattern: '3080', vramGb: 12 },
      { modelPattern: '3070', vramGb: 8 },
    ],
  },
  {
    keywords: ['amd', 'radeon'],
    models: [
      { modelPattern: '7900', vramGb: 20 },
      { modelPattern: '7800', vramGb: 16 },
      { modelPattern: '6900', vramGb: 16 },
    ],
  },
  {
    keywords: ['apple'],
    models: [
      { modelPattern: 'm3 max', vramGb: 32 },
      { modelPattern: 'm3 pro', vramGb: 24 },
      { modelPattern: 'm2 max', vramGb: 24 },
      { modelPattern: 'm3', vramGb: 12 },
      { modelPattern: 'm2 pro', vramGb: 12 },
      { modelPattern: 'm2', vramGb: 8 },
      { modelPattern: 'm1 pro', vramGb: 8 },
    ],
    fallbackGb: 4,
  },
  {
    keywords: ['intel'],
    models: [],
    fallbackGb: 2,
  },
];

/** Find the VRAM cap for a given vendor/model in the lookup table. */
function lookupVramCap(haystack: string): number | undefined {
  for (const vendor of VRAM_TABLE) {
    if (!vendor.keywords.some((kw) => haystack.includes(kw))) continue;

    for (const model of vendor.models) {
      if (haystack.includes(model.modelPattern)) {
        return model.vramGb;
      }
    }

    return vendor.fallbackGb;
  }
  return undefined;
}

/**
 * Estimate available VRAM based on adapter info and limits.
 */
function estimateVRAM(maxBufferSize: number, adapterInfo: GPUAdapterInfoCustom): number {
  // Base estimate from max buffer size (usually 1/4 to 1/2 of VRAM)
  const base = (maxBufferSize / (1024 * 1024 * 1024)) * 2;

  // Build a single haystack string for matching
  const haystack = [
    adapterInfo.vendor,
    adapterInfo.device,
    adapterInfo.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const cap = lookupVramCap(haystack);
  const estimate = cap !== undefined ? Math.min(base, cap) : base;

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
