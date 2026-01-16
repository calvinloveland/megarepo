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

export class InferenceEngine {
  private engine: webllm.MLCEngine | null = null;
  private currentModelId: string | null = null;
  private isLoading = false;

  /**
   * Load a model for inference
   */
  async loadModel(
    model: ModelInfo,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (this.isLoading) {
      throw new Error('Model loading already in progress');
    }

    if (this.currentModelId === model.mlc_model_id) {
      console.log('Model already loaded');
      return;
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
      this.engine = await webllm.CreateMLCEngine(model.mlc_model_id, {
        initProgressCallback,
      });

      this.currentModelId = model.mlc_model_id;
      console.log(`Model ${model.name} loaded successfully`);
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
