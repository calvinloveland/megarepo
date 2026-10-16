/**
 * Inference backend abstraction.
 *
 * HiveMind peers should be able to run a model regardless of whether the
 * browser exposes WebGPU. WebGPU is fast but is still gated behind a flag on
 * several platforms (notably Linux/Android), so the app falls back to a
 * CPU/WASM backend instead of refusing to start.
 */

import type { BackendKind, GenerationProgress, ModelInfo } from '../types';

export type { BackendKind };

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export type ProgressCallback = (progress: GenerationProgress) => void;
export type TokenCallback = (token: string) => void;

export interface LoadOptions {
  /** Estimated VRAM (GB) used to avoid loading a model that will not fit. */
  maxVramGB?: number;
  /** Fraction (0-1) of the model that has been loaded so far. */
  onProgress?: (progress: number, text?: string) => void;
}

export interface ResolvedModel {
  modelId: string;
  /** Set when the requested model could not be used verbatim. */
  fallbackReason?: string;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  onToken?: TokenCallback;
  onProgress?: ProgressCallback;
}

export interface InferenceBackend {
  readonly kind: BackendKind;
  /** Human-readable backend name for the UI. */
  readonly label: string;
  loadModel(model: ModelInfo, options?: LoadOptions): Promise<ResolvedModel>;
  isModelLoaded(): boolean;
  getCurrentModelId(): string | null;
  generate(messages: ChatTurn[], options?: GenerateOptions): Promise<string>;
  resetChat(): Promise<void>;
  unload(): Promise<void>;
}
