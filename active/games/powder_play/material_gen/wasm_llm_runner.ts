// Wrapper to integrate a WASM-based LLM runtime in the browser.
// For MVP this is a stub that exposes the same API as real runtimes.

import { isModelAvailable } from './local_model_manager';
import { generateMaterialFromIntent } from './llm_adapter';
import { generateDemoModel } from './demo_model';

export async function hasWasmRuntime(): Promise<boolean> {
  // In real integration check for the availability of the WASM module and necessary GPU
  return await isModelAvailable();
}

export async function runWasmModel(intent: string, onProgress?: (m:string)=>void) {
  onProgress && onProgress('invoking-wasm-model');
  // TODO: integrate with actual WASM runtime (ggml-web, llama.cpp wasm builds, etc.)
  // For now return a deterministic demo model so we can validate end-to-end locally.
  const ast = generateDemoModel(intent);
  onProgress && onProgress('wasm-complete');
  return ast;
}
