/**
 * Inference backend tests.
 *
 * Covers backend selection, WASM model resolution, the WASM engine (with an
 * injected Transformers.js stub), and WebGPU -> WASM fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelInfo, WebGPUInfo } from '../types';
import type { BackendKind, InferenceBackend } from '../inference/backend';
import {
  DEFAULT_WASM_MODEL,
  WasmInferenceEngine,
  __setTransformersLoader,
  resolveWasmModelId,
  type TransformersModule,
} from '../inference/wasmEngine';
import { BackendManager } from '../inference/backendManager';
import { chooseBackendKind, describeBackendChoice } from '../inference/detect';

const SMOL_MODEL: ModelInfo = {
  id: 'smollm-135m',
  name: 'SmolLM 135M',
  mlc_model_id: 'SmolLM-135M-Instruct-q4f16_1-MLC',
  num_layers: 12,
};

function gpuInfo(overrides: Partial<WebGPUInfo> = {}): WebGPUInfo {
  return {
    supported: true,
    adapter: { vendor: 'Test', architecture: 'test', device: 'GPU', description: '' },
    limits: null,
    estimatedVRAM: 4,
    ...overrides,
  };
}

describe('resolveWasmModelId', () => {
  it('maps a known registry id to an ONNX repo', () => {
    expect(resolveWasmModelId(SMOL_MODEL).modelId).toBe(
      'HuggingFaceTB/SmolLM2-135M-Instruct'
    );
  });

  it('maps a known MLC id to the canonical ONNX repo', () => {
    const model: ModelInfo = {
      id: 'llama-3.2-1b',
      name: 'Llama 3.2 1B',
      mlc_model_id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      num_layers: 16,
    };
    expect(resolveWasmModelId(model).modelId).toBe(
      'onnx-community/Llama-3.2-1B-Instruct-ONNX'
    );
  });

  it('honours an explicit wasmModelId repo id', () => {
    const model: ModelInfo = { ...SMOL_MODEL, wasmModelId: 'org/custom-model' };
    expect(resolveWasmModelId(model)).toEqual({ modelId: 'org/custom-model' });
  });

  it('falls back to the default model with a reason for unknown models', () => {
    const model: ModelInfo = {
      id: 'mystery',
      name: 'Mystery',
      mlc_model_id: 'mystery-mlc',
      num_layers: 1,
    };
    const resolved = resolveWasmModelId(model);
    expect(resolved.modelId).toBe(DEFAULT_WASM_MODEL);
    expect(resolved.fallbackReason).toContain('Mystery');
  });
});

describe('chooseBackendKind', () => {
  it('prefers WebGPU when supported with enough VRAM', () => {
    expect(chooseBackendKind(gpuInfo())).toBe('webgpu');
  });

  it('falls back to WASM when WebGPU is unsupported', () => {
    expect(chooseBackendKind(gpuInfo({ supported: false }))).toBe('wasm');
  });

  it('falls back to WASM when VRAM is too low', () => {
    expect(chooseBackendKind(gpuInfo({ estimatedVRAM: 0.2 }))).toBe('wasm');
  });

  it('still returns WebGPU when neither backend is usable', () => {
    expect(chooseBackendKind(gpuInfo({ supported: false }), false)).toBe('webgpu');
  });

  it('explains the choice', () => {
    expect(describeBackendChoice(gpuInfo({ supported: false }), 'wasm')).toContain(
      'No browser flag required'
    );
  });
});

describe('WasmInferenceEngine', () => {
  beforeEach(() => {
    __setTransformersLoader(async () => {
      throw new Error('loader not configured');
    });
  });

  function fakeModule(captured: Array<{ task: string; model: string; options: Record<string, unknown> }>) {
    const pipeline = vi.fn(async (task: string, model: string, options: Record<string, unknown>) => {
      captured.push({ task, model, options });
      const generator = async (
        _input: unknown,
        callOptions: Record<string, unknown> = {}
      ) => {
        const streamer = callOptions.streamer as { options?: Record<string, unknown> } | undefined;
        const callback = streamer?.options?.callback_function as
          | ((text: string) => void)
          | undefined;
        callback?.('Hello ');
        callback?.('world');
        return [{ generated_text: 'Hello world' }];
      };
      return Object.assign(generator, { tokenizer: {} });
    });

    class FakeTextStreamer {
      options: Record<string, unknown>;
      constructor(_tokenizer: unknown, options: Record<string, unknown>) {
        this.options = options;
      }
    }

    const module: TransformersModule = {
      pipeline: pipeline as unknown as TransformersModule['pipeline'],
      TextStreamer: FakeTextStreamer as unknown as TransformersModule['TextStreamer'],
    };
    return { module, pipeline };
  }

  it('loads a model on the WASM device and streams generated text', async () => {
    const captured: Array<{ task: string; model: string; options: Record<string, unknown> }> = [];
    const { module, pipeline } = fakeModule(captured);
    __setTransformersLoader(async () => module);

    const engine = new WasmInferenceEngine();
    const resolved = await engine.loadModel(SMOL_MODEL);

    expect(resolved.modelId).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(captured[0].task).toBe('text-generation');
    expect(captured[0].options.device).toBe('wasm');
    expect(engine.isModelLoaded()).toBe(true);

    const tokens: string[] = [];
    const text = await engine.generate([{ role: 'user', content: 'hi' }], {
      onToken: (token) => tokens.push(token),
    });

    expect(text).toBe('Hello world');
    expect(tokens).toEqual(['Hello ', 'world']);
  });

  it('reports load progress as a 0-1 fraction', async () => {
    const captured: Array<{ task: string; model: string; options: Record<string, unknown> }> = [];
    const { module } = fakeModule(captured);
    __setTransformersLoader(async () => module);

    const engine = new WasmInferenceEngine();
    const seen: number[] = [];
    await engine.loadModel(SMOL_MODEL, { onProgress: (progress) => seen.push(progress) });

    const options = captured[0].options as {
      progress_callback: (report: { progress?: number; file?: string }) => void;
    };
    options.progress_callback({ progress: 25, file: 'model.onnx' });
    options.progress_callback({ progress: 100 });

    expect(seen).toEqual([0.25, 1]);
  });
});

describe('BackendManager', () => {
  const model: ModelInfo = SMOL_MODEL;

  function makeBackend(
    kind: BackendKind,
    loadModel: InferenceBackend['loadModel']
  ): InferenceBackend {
    return {
      kind,
      label: kind,
      loadModel,
      isModelLoaded: () => false,
      getCurrentModelId: () => null,
      generate: vi.fn().mockResolvedValue('ok'),
      resetChat: vi.fn().mockResolvedValue(undefined),
      unload: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('uses WebGPU when it loads successfully', async () => {
    const webgpu = makeBackend('webgpu', vi.fn().mockResolvedValue({ modelId: 'gpu-model' }));
    const wasm = makeBackend('wasm', vi.fn().mockResolvedValue({ modelId: 'cpu-model' }));
    const manager = new BackendManager({ webgpu, wasm });

    const result = await manager.loadModel(model, 'webgpu');

    expect(result).toEqual({ modelId: 'gpu-model', backend: 'webgpu' });
    expect(manager.activeKind).toBe('webgpu');
    expect(wasm.loadModel).not.toHaveBeenCalled();
  });

  it('falls back to WASM when WebGPU fails and records the fallback', async () => {
    const webgpu = makeBackend('webgpu', vi.fn().mockRejectedValue(new Error('no WebGPU flag')));
    const wasm = makeBackend('wasm', vi.fn().mockResolvedValue({ modelId: 'cpu-model' }));
    const manager = new BackendManager({ webgpu, wasm });

    const result = await manager.loadModel(model, 'webgpu');

    expect(result).toEqual({ modelId: 'cpu-model', backend: 'wasm' });
    expect(manager.activeKind).toBe('wasm');
    expect(webgpu.unload).toHaveBeenCalled();
  });

  it('never tries WebGPU when WASM is preferred', async () => {
    const webgpu = makeBackend('webgpu', vi.fn().mockResolvedValue({ modelId: 'gpu-model' }));
    const wasm = makeBackend('wasm', vi.fn().mockResolvedValue({ modelId: 'cpu-model' }));
    const manager = new BackendManager({ webgpu, wasm });

    const result = await manager.loadModel(model, 'wasm');

    expect(result.backend).toBe('wasm');
    expect(webgpu.loadModel).not.toHaveBeenCalled();
  });

  it('throws when no backend can load the model', async () => {
    const webgpu = makeBackend('webgpu', vi.fn().mockRejectedValue(new Error('gpu down')));
    const wasm = makeBackend('wasm', vi.fn().mockRejectedValue(new Error('wasm down')));
    const manager = new BackendManager({ webgpu, wasm });

    await expect(manager.loadModel(model, 'webgpu')).rejects.toThrow('wasm down');
  });
});
