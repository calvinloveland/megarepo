/**
 * Backend manager: picks a backend for the cluster's model and transparently
 * falls back from WebGPU to WASM when the GPU path is unavailable.
 */

import type { ModelInfo } from '../types';
import type {
  BackendKind,
  ChatTurn,
  GenerateOptions,
  InferenceBackend,
  LoadOptions,
} from './backend';
import { InferenceEngine } from './engine';
import { WasmInferenceEngine } from './wasmEngine';

export interface BackendLoadResult {
  modelId: string;
  fallbackReason?: string;
  backend: BackendKind;
}

export class BackendManager {
  private readonly engines: Record<BackendKind, InferenceBackend>;
  private active: InferenceBackend | null = null;

  constructor(engines?: Partial<Record<BackendKind, InferenceBackend>>) {
    this.engines = {
      webgpu: engines?.webgpu ?? new InferenceEngine(),
      wasm: engines?.wasm ?? new WasmInferenceEngine(),
    };
  }

  get activeKind(): BackendKind | null {
    return this.active?.kind ?? null;
  }

  get activeLabel(): string | null {
    return this.active?.label ?? null;
  }

  isModelLoaded(): boolean {
    return this.active?.isModelLoaded() ?? false;
  }

  getCurrentModelId(): string | null {
    return this.active?.getCurrentModelId() ?? null;
  }

  /**
   * Load a model, preferring `preferred` but falling back to the other
   * backend if loading fails (e.g. WebGPU without the required feature flags).
   */
  async loadModel(
    model: ModelInfo,
    preferred: BackendKind,
    options?: LoadOptions
  ): Promise<BackendLoadResult> {
    const order: BackendKind[] = preferred === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
    let lastError: unknown = null;

    for (const kind of order) {
      const engine = this.engines[kind];
      try {
        const resolved = await engine.loadModel(model, options);
        this.active = engine;
        return { ...resolved, backend: kind };
      } catch (error) {
        lastError = error;
        await engine.unload().catch(() => undefined);
        if (kind === preferred && order.length > 1) {
          console.warn(`${kind} backend failed to load ${model.name}; trying fallback`, error);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('No inference backend could load the model');
  }

  async generate(messages: ChatTurn[], options?: GenerateOptions): Promise<string> {
    if (!this.active) {
      throw new Error('No model loaded');
    }
    return this.active.generate(messages, options);
  }

  async resetChat(): Promise<void> {
    await this.active?.resetChat();
  }

  async unload(): Promise<void> {
    await this.active?.unload();
    this.active = null;
  }
}

export const backendManager = new BackendManager();
