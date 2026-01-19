/**
 * Inference engine wrapper for WebLLM
 * 
 * This module handles model loading and inference using MLC's WebLLM.
 * In a full distributed implementation, this would be extended to handle
 * partial model loading (specific layers) and hidden state I/O.
 */

import * as webllm from '@mlc-ai/web-llm';
import type { ModelInfo, GenerationProgress } from '../types';

type ProgressCallback = (progress: GenerationProgress) => void;
type TokenCallback = (token: string) => void;

type ModelResolution = {
  modelId: string;
  fallbackReason?: string;
};

type LoadOptions = {
  maxVramGB?: number;
};

const MODEL_ID_ALIASES: Record<string, string> = {
  'SmolLM-135M-Instruct-q4f16_1-MLC': 'SmolLM2-135M-Instruct-q0f32-MLC',
  'SmolLM-135M-Instruct-q4f32_1-MLC': 'SmolLM2-135M-Instruct-q0f32-MLC',
};

const getPrebuiltModelRecord = (modelId: string) => {
  const normalized = modelId.toLowerCase();
  return webllm.prebuiltAppConfig.model_list.find(
    (record) => record.model_id.toLowerCase() === normalized
  );
};

const normalizeModelId = (modelId: string) => {
  const alias = MODEL_ID_ALIASES[modelId];
  if (alias) {
    return alias;
  }

  const record = getPrebuiltModelRecord(modelId);
  return record?.model_id ?? modelId;
};

const supportsShaderF16 = async (): Promise<boolean> => {
  if (!navigator.gpu?.requestAdapter) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return adapter?.features?.has('shader-f16') ?? false;
  } catch {
    return false;
  }
};

const pickFallbackModel = (maxVramGB?: number, hasF16?: boolean) => {
  const maxVramMB = maxVramGB ? maxVramGB * 1024 : undefined;
  const candidates = webllm.prebuiltAppConfig.model_list
    .filter((record) => {
      const isLLM = !record.model_type || record.model_type === webllm.ModelType.LLM;
      if (!isLLM) return false;
      if (!record.vram_required_MB) return false;
      if (maxVramMB && record.vram_required_MB > maxVramMB) return false;
      if (!hasF16 && (record.required_features || []).includes('shader-f16')) return false;
      return true;
    })
    .sort((a, b) => (a.vram_required_MB ?? Infinity) - (b.vram_required_MB ?? Infinity));

  return candidates[0];
};

const resolveModelId = async (modelId: string, options?: LoadOptions): Promise<ModelResolution> => {
  const normalized = normalizeModelId(modelId);
  const hasF16 = await supportsShaderF16();
  const record = getPrebuiltModelRecord(normalized);
  const maxVramMB = options?.maxVramGB ? options.maxVramGB * 1024 : undefined;

  if (record && maxVramMB && record.vram_required_MB && record.vram_required_MB > maxVramMB) {
    const fallback = pickFallbackModel(options?.maxVramGB, hasF16);
    if (fallback) {
      return {
        modelId: fallback.model_id,
        fallbackReason: `Assigned model exceeds estimated VRAM. Using ${fallback.model_id} instead.`,
      };
    }
  }

  if (record && !(record.required_features || []).includes('shader-f16') && hasF16) {
    return { modelId: normalized };
  }

  if (record && hasF16) {
    return { modelId: normalized };
  }

  const candidates = [
    normalized.replace('q4f16_1', 'q4f32_1'),
    normalized.replace('q4f16', 'q4f32'),
    normalized.replace('q0f16', 'q0f32'),
  ].filter((candidate, index, arr) => candidate !== normalized && arr.indexOf(candidate) === index);

  for (const candidate of candidates) {
    const record = getPrebuiltModelRecord(candidate);
    if (record && !(record.required_features || []).includes('shader-f16')) {
      return {
        modelId: record.model_id,
        fallbackReason: `GPU does not support shader-f16. Switching to ${record.model_id}.`,
      };
    }
  }

  const fallback = pickFallbackModel(options?.maxVramGB, hasF16);
  if (fallback) {
    return {
      modelId: fallback.model_id,
      fallbackReason: hasF16
        ? `Model ${normalized} is not available in the bundled model list. Using ${fallback.model_id} instead.`
        : `Model ${normalized} requires shader-f16, which is not supported. Using ${fallback.model_id} instead.`,
    };
  }

  throw new Error(
    `Model ${normalized} requires shader-f16 or exceeds available VRAM, and no compatible fallback was found.`
  );
};

export class InferenceEngine {
  private engine: webllm.MLCEngine | null = null;
  private currentModelId: string | null = null;
  private isLoading = false;

  /**
   * Load a model for inference
   */
  async loadModel(
    model: ModelInfo,
    onProgress?: (progress: number) => void,
    options?: LoadOptions
  ): Promise<ModelResolution> {
    if (this.isLoading) {
      throw new Error('Model loading already in progress');
    }

    const resolved = await resolveModelId(model.mlc_model_id, options);

    if (this.currentModelId === resolved.modelId) {
      console.log('Model already loaded');
      return resolved;
    }

    this.isLoading = true;

    try {
      // Create progress callback
      const initProgressCallback = (report: webllm.InitProgressReport) => {
        console.log('Load progress:', report.text);
        if (onProgress) {
          // Parse progress percentage from text or estimate
          const match = report.text.match(/(\d+)%/);
          if (match) {
            onProgress(parseInt(match[1]) / 100);
          }
        }
      };

      // Initialize engine with the model
      if (resolved.fallbackReason) {
        console.warn(resolved.fallbackReason);
      }

      this.engine = await webllm.CreateMLCEngine(resolved.modelId, {
        initProgressCallback,
      });

      this.currentModelId = resolved.modelId;
      console.log(`Model ${model.name} loaded successfully (${resolved.modelId})`);
      return resolved;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Check if a model is loaded
   */
  isModelLoaded(): boolean {
    return this.engine !== null;
  }

  /**
   * Get the current model ID
   */
  getCurrentModelId(): string | null {
    return this.currentModelId;
  }

  /**
   * Generate a response (streaming)
   */
  async generate(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options: {
      maxTokens?: number;
      temperature?: number;
      topP?: number;
      onToken?: TokenCallback;
      onProgress?: ProgressCallback;
    } = {}
  ): Promise<string> {
    if (!this.engine) {
      throw new Error('No model loaded');
    }

    const {
      maxTokens = 512,
      temperature = 0.7,
      topP = 0.9,
      onToken,
      onProgress,
    } = options;

    let generatedText = '';
    let tokensGenerated = 0;
    const startTime = Date.now();

    try {
      onProgress?.({
        status: 'generating',
        tokens_generated: 0,
        tokens_per_second: 0,
      });

      // Use streaming completion
      const asyncGenerator = await this.engine.chat.completions.create({
        messages,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        stream: true,
      });

      for await (const chunk of asyncGenerator) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          generatedText += delta;
          tokensGenerated++;
          onToken?.(delta);

          const elapsed = (Date.now() - startTime) / 1000;
          onProgress?.({
            status: 'generating',
            tokens_generated: tokensGenerated,
            tokens_per_second: tokensGenerated / elapsed,
          });
        }
      }

      onProgress?.({
        status: 'complete',
        tokens_generated: tokensGenerated,
        tokens_per_second: tokensGenerated / ((Date.now() - startTime) / 1000),
      });

      return generatedText;
    } catch (error) {
      onProgress?.({
        status: 'error',
        tokens_generated: tokensGenerated,
        tokens_per_second: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Reset the chat (clear KV cache)
   */
  async resetChat(): Promise<void> {
    if (this.engine) {
      await this.engine.resetChat();
    }
  }

  /**
   * Unload the current model
   */
  async unload(): Promise<void> {
    if (this.engine) {
      await this.engine.unload();
      this.engine = null;
      this.currentModelId = null;
    }
  }

  /**
   * Get runtime stats
   */
  async getStats(): Promise<{ vramUsed: number } | null> {
    if (!this.engine) return null;
    
    try {
      // WebLLM doesn't directly expose VRAM usage, but we can estimate
      // based on the model configuration
      return { vramUsed: 0 };
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const inferenceEngine = new InferenceEngine();
