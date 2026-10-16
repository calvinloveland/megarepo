/**
 * Compute capability detection and backend selection.
 *
 * The key goal is that an unavailable WebGPU must never block the app: we
 * simply recommend the CPU/WASM backend instead of telling the user to flip a
 * browser flag.
 */

import type { WebGPUInfo } from '../types';
import type { BackendKind } from './backend';
import { detectWebGPU } from './webgpu';

export interface InferenceCapabilities {
  webgpu: WebGPUInfo;
  wasmSupported: boolean;
  recommended: BackendKind;
  reason: string;
}

/** Minimum estimated VRAM before WebGPU is worth using for LLM inference. */
export const MIN_WEBGPU_VRAM_GB = 0.5;

export function chooseBackendKind(
  webgpu: WebGPUInfo,
  wasmSupported: boolean = true
): BackendKind {
  if (webgpu.supported && webgpu.estimatedVRAM >= MIN_WEBGPU_VRAM_GB) {
    return 'webgpu';
  }
  return wasmSupported ? 'wasm' : 'webgpu';
}

export function describeBackendChoice(webgpu: WebGPUInfo, recommended: BackendKind): string {
  if (recommended === 'webgpu') {
    return 'WebGPU available — using GPU acceleration.';
  }
  if (webgpu.supported) {
    return 'WebGPU has too little memory — using CPU (WASM).';
  }
  return 'WebGPU unavailable — using CPU (WASM). No browser flag required.';
}

export async function detectInferenceCapabilities(): Promise<InferenceCapabilities> {
  const webgpu = await detectWebGPU();
  const wasmSupported = typeof WebAssembly !== 'undefined';
  const recommended = chooseBackendKind(webgpu, wasmSupported);

  return {
    webgpu,
    wasmSupported,
    recommended,
    reason: describeBackendChoice(webgpu, recommended),
  };
}
