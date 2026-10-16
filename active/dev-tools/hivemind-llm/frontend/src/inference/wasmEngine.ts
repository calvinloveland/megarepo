/**
 * CPU/WASM inference backend built on Transformers.js (ONNX Runtime Web).
 *
 * This is the no-WebGPU path: it runs quantized ONNX models on the CPU using
 * WebAssembly, so it works in stock Chrome/Firefox/Safari without enabling
 * chrome://flags/#enable-unsafe-webgpu (or the platform equivalent).
 *
 * The Transformers.js bundle is imported lazily so that browsers which do run
 * the WebGPU backend never pay for it.
 */

import type { ModelInfo } from '../types';
import type {
  ChatTurn,
  GenerateOptions,
  InferenceBackend,
  LoadOptions,
  ResolvedModel,
} from './backend';

/** Default CPU-friendly chat model when no mapping is known. */
export const DEFAULT_WASM_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';

/**
 * Maps HiveMind model identifiers (registry id, MLC id, or an explicit
 * `wasmModelId`) to a Transformers.js / ONNX repo on the Hugging Face Hub.
 */
export const WASM_MODEL_ALIASES: Record<string, string> = {
  'smollm-135m': 'HuggingFaceTB/SmolLM2-135M-Instruct',
  'SmolLM-135M-Instruct-q4f16_1-MLC': 'HuggingFaceTB/SmolLM2-135M-Instruct',
  'SmolLM2-135M-Instruct-q0f32-MLC': 'HuggingFaceTB/SmolLM2-135M-Instruct',
  'llama-3.2-1b': 'onnx-community/Llama-3.2-1B-Instruct',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC': 'onnx-community/Llama-3.2-1B-Instruct',
  'llama-3.2-3b': 'onnx-community/Llama-3.2-3B-Instruct',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC': 'onnx-community/Llama-3.2-3B-Instruct',
};

export function resolveWasmModelId(model: ModelInfo): ResolvedModel {
  const candidates = [model.wasmModelId, model.id, model.mlc_model_id].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );

  for (const candidate of candidates) {
    const mapped = WASM_MODEL_ALIASES[candidate];
    if (mapped) {
      return { modelId: mapped };
    }
    // Already a Hugging Face repo id (e.g. "org/model").
    if (candidate.includes('/')) {
      return { modelId: candidate };
    }
  }

  return {
    modelId: DEFAULT_WASM_MODEL,
    fallbackReason: `No WASM/ONNX mapping for ${model.name}; using ${DEFAULT_WASM_MODEL}.`,
  };
}

// ---------------------------------------------------------------------------
// Minimal Transformers.js surface (kept structural so tests can inject a stub)
// ---------------------------------------------------------------------------

interface ProgressReport {
  status?: string;
  file?: string;
  progress?: number;
}

type TextGenerationPipeline = {
  (input: unknown, options?: Record<string, unknown>): Promise<unknown>;
  tokenizer: unknown;
};

type TextStreamerCtor = new (
  tokenizer: unknown,
  options: Record<string, unknown>
) => unknown;

export interface TransformersModule {
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>
  ) => Promise<TextGenerationPipeline>;
  TextStreamer: TextStreamerCtor;
}

let loadTransformers: () => Promise<TransformersModule> = async () =>
  (await import('@huggingface/transformers')) as unknown as TransformersModule;

/** Test seam: override how the Transformers.js module is loaded. */
export function __setTransformersLoader(loader: () => Promise<TransformersModule>): void {
  loadTransformers = loader;
}

function extractGeneratedText(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || typeof first !== 'object') {
    return '';
  }

  const generatedText = (first as { generated_text?: unknown }).generated_text;
  if (typeof generatedText === 'string') {
    return generatedText;
  }

  if (Array.isArray(generatedText)) {
    const last = generatedText[generatedText.length - 1];
    if (typeof last === 'string') {
      return last;
    }
    if (last && typeof last === 'object' && 'content' in last) {
      const content = (last as { content?: unknown }).content;
      return typeof content === 'string' ? content : '';
    }
  }

  return '';
}

export class WasmInferenceEngine implements InferenceBackend {
  readonly kind = 'wasm' as const;
  readonly label = 'WASM (CPU)';

  private generator: TextGenerationPipeline | null = null;
  private currentModelId: string | null = null;
  private isLoading = false;

  async loadModel(model: ModelInfo, options?: LoadOptions): Promise<ResolvedModel> {
    if (this.isLoading) {
      throw new Error('Model loading already in progress');
    }

    const resolved = resolveWasmModelId(model);
    if (this.currentModelId === resolved.modelId) {
      return resolved;
    }

    this.isLoading = true;
    try {
      if (resolved.fallbackReason) {
        console.warn(resolved.fallbackReason);
      }

      const { pipeline } = await loadTransformers();
      this.generator = await pipeline('text-generation', resolved.modelId, {
        device: 'wasm',
        dtype: 'q4',
        progress_callback: (report: ProgressReport) => {
          const progress = typeof report?.progress === 'number' ? report.progress / 100 : 0;
          options?.onProgress?.(progress, report?.file ?? report?.status);
        },
      });

      this.currentModelId = resolved.modelId;
      console.log(`WASM model loaded: ${resolved.modelId}`);
      return resolved;
    } finally {
      this.isLoading = false;
    }
  }

  isModelLoaded(): boolean {
    return this.generator !== null;
  }

  getCurrentModelId(): string | null {
    return this.currentModelId;
  }

  async generate(messages: ChatTurn[], options: GenerateOptions = {}): Promise<string> {
    if (!this.generator) {
      throw new Error('No model loaded');
    }

    const generator = this.generator;
    const {
      maxTokens = 512,
      temperature = 0.7,
      topP = 0.9,
      onToken,
      onProgress,
    } = options;

    const { TextStreamer } = await loadTransformers();

    const startTime = Date.now();
    let generated = '';
    let tokensGenerated = 0;

    const reportProgress = (status: 'generating' | 'complete' | 'error', error?: string) => {
      const elapsed = (Date.now() - startTime) / 1000;
      onProgress?.({
        status,
        tokens_generated: tokensGenerated,
        tokens_per_second: elapsed > 0 ? tokensGenerated / elapsed : 0,
        error,
      });
    };

    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        generated += text;
        tokensGenerated += 1;
        onToken?.(text);
        reportProgress('generating');
      },
    });

    reportProgress('generating');

    try {
      const output = await generator(messages, {
        max_new_tokens: maxTokens,
        do_sample: temperature > 0,
        temperature,
        top_p: topP,
        return_full_text: false,
        streamer,
      });

      reportProgress('complete');
      return generated || extractGeneratedText(output);
    } catch (error) {
      reportProgress('error', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async resetChat(): Promise<void> {
    // Transformers.js does not keep a persistent KV cache between calls.
  }

  async unload(): Promise<void> {
    this.generator = null;
    this.currentModelId = null;
  }
}
