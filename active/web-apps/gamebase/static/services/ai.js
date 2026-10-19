/*
 * GamebaseAI — the platform's on-device LLM service.
 *
 * Games are static clients with no per-game backend, so the model runs in the
 * browser: Transformers.js (ONNX Runtime Web) executes a quantized chat model
 * on the CPU via WebAssembly. Nothing is sent to a server and there is no API
 * key to configure. The first call downloads the model from the Hugging Face
 * Hub; after that the browser caches it (games that use this service should
 * declare `capabilities.sandbox: same-origin` so the Cache API is available).
 *
 * Inference runs in a Web Worker when the browser allows one, so the game stays
 * responsive and streamed tokens actually paint. If workers are unavailable
 * (for example in a strict, opaque-origin sandbox) it falls back to running on
 * the main thread.
 *
 * Load it from a game (classic script, no build step):
 *
 *   <script src="/static/services/ai.js"></script>
 *
 *   await GamebaseAI.ready({
 *     model: GamebaseAI.models.balanced,
 *     onProgress: ({ progress }) => console.log(progress),
 *   });
 *   const reply = await GamebaseAI.chat({
 *     system: "You are a wary homeowner.",
 *     messages: [{ role: "user", content: "Cold night, isn't it?" }],
 *     maxTokens: 80,
 *     onToken: (chunk) => process.stdout.write(chunk),
 *   });
 *
 * The runtime is loaded lazily from a pinned CDN so the platform does not have
 * to ship ~27 MB of WebAssembly. Self-hosters can point it elsewhere:
 *
 *   <script>window.GAMEBASE_AI_RUNTIME = "/static/services/vendor/transformers.web.js";</script>
 */
(function (global) {
  "use strict";

  const VERSION = "1.1.0";
  const WORKER_URL = "/static/services/ai-worker.js";
  const DEFAULT_RUNTIME_URL =
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";

  // Small, CPU-friendly chat models that ship q4 ONNX weights.
  const MODELS = Object.freeze({
    fast: "HuggingFaceTB/SmolLM2-135M-Instruct",
    balanced: "HuggingFaceTB/SmolLM2-360M-Instruct",
    sharp: "onnx-community/Qwen2.5-0.5B-Instruct",
  });

  // ── Worker-backed inference ────────────────────────────────────────────

  let worker = null;
  let workerBroken = false;
  let workerSequence = 0;
  const workerPending = new Map();

  // ── Main-thread fallback ───────────────────────────────────────────────

  let runtimePromise = null;
  let generator = null;

  // ── Shared state ───────────────────────────────────────────────────────

  let loaded = { model: null, device: null, dtype: null, mode: null };
  let readyFlag = false;
  let loadingPromise = null;

  function runtimeUrl() {
    return global.GAMEBASE_AI_RUNTIME || DEFAULT_RUNTIME_URL;
  }

  function errorMessage(error) {
    return error && error.message ? error.message : String(error);
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};
    const pending = workerPending.get(message.id);
    if (!pending) return;

    if (message.type === "progress") {
      if (pending.onProgress) pending.onProgress(message);
      return;
    }
    if (message.type === "token") {
      if (pending.onToken) pending.onToken(message.token);
      return;
    }
    workerPending.delete(message.id);
    if (message.type === "done") {
      pending.resolve(message);
    } else if (message.type === "error") {
      pending.reject(new Error(message.error || "GamebaseAI worker failed"));
    }
  }

  function failPendingWorkers(reason) {
    workerBroken = true;
    worker = null;
    workerPending.forEach((pending) => pending.reject(new Error(reason)));
    workerPending.clear();
  }

  function ensureWorker() {
    if (worker || workerBroken) return worker;
    if (typeof global.Worker !== "function") {
      workerBroken = true;
      return null;
    }
    try {
      worker = new global.Worker(WORKER_URL, { type: "module" });
      worker.addEventListener("message", handleWorkerMessage);
      worker.addEventListener("error", (event) => {
        failPendingWorkers(
          "GamebaseAI worker failed: " + ((event && event.message) || "unknown error")
        );
      });
      return worker;
    } catch (error) {
      workerBroken = true;
      worker = null;
      return null;
    }
  }

  function requestWorker(payload, handlers) {
    const target = ensureWorker();
    if (!target) return null;

    const id = ++workerSequence;
    return new Promise((resolve, reject) => {
      workerPending.set(id, {
        resolve,
        reject,
        onProgress: handlers && handlers.onProgress,
        onToken: handlers && handlers.onToken,
      });
      target.postMessage(Object.assign({ id: id, runtimeUrl: runtimeUrl() }, payload));
    });
  }

  // ── Main-thread fallback ───────────────────────────────────────────────

  function loadRuntime() {
    if (!runtimePromise) {
      const url = runtimeUrl();
      runtimePromise = import(url).catch((error) => {
        runtimePromise = null;
        throw new Error(
          "GamebaseAI could not load its runtime from " +
            url +
            " (" +
            errorMessage(error) +
            "). Set window.GAMEBASE_AI_RUNTIME to a self-hosted build if the CDN is blocked."
        );
      });
    }
    return runtimePromise;
  }

  function canUseBrowserCache() {
    try {
      return typeof global.caches !== "undefined" && Boolean(global.caches);
    } catch (error) {
      return false;
    }
  }

  async function loadLocally(model, dtype, options) {
    const transformers = await loadRuntime();
    const env = transformers.env;
    env.allowLocalModels = false;
    env.useBrowserCache = options.cache === false ? false : canUseBrowserCache();

    const progress_callback = (report) => {
      if (typeof options.onProgress !== "function") return;
      options.onProgress({
        model,
        progress:
          report && typeof report.progress === "number" ? report.progress / 100 : null,
        file: (report && report.file) || null,
        status: (report && report.status) || null,
      });
    };

    generator = await transformers.pipeline("text-generation", model, {
      device: "wasm",
      dtype,
      progress_callback,
    });
  }

  function extractText(output) {
    const first = Array.isArray(output) ? output[0] : output;
    if (!first || typeof first !== "object") return "";

    const generated = first.generated_text;
    if (typeof generated === "string") return generated;

    if (Array.isArray(generated)) {
      const last = generated[generated.length - 1];
      if (typeof last === "string") return last;
      if (last && typeof last === "object" && typeof last.content === "string") {
        return last.content;
      }
    }
    return "";
  }

  async function chatLocally(options) {
    const transformers = await loadRuntime();
    const messages = [];
    if (options.system) messages.push({ role: "system", content: String(options.system) });
    (options.messages || []).forEach((message) => {
      if (message && message.role && typeof message.content === "string") {
        messages.push({ role: message.role, content: message.content });
      }
    });

    const onToken = typeof options.onToken === "function" ? options.onToken : null;
    let streamed = "";
    let streamer = null;
    if (onToken && typeof transformers.TextStreamer === "function") {
      streamer = new transformers.TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (chunk) => {
          streamed += chunk;
          onToken(chunk);
        },
      });
    }

    const generateOptions = {
      max_new_tokens: options.maxTokens || 96,
      do_sample: options.temperature !== 0,
      temperature: options.temperature == null ? 0.8 : options.temperature,
      top_p: options.topP == null ? 0.9 : options.topP,
      repetition_penalty:
        options.repetitionPenalty == null ? 1.1 : options.repetitionPenalty,
      return_full_text: false,
    };
    if (streamer) generateOptions.streamer = streamer;

    const output = await generator(messages, generateOptions);
    return (streamed || extractText(output)).trim();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  function isReady() {
    return readyFlag;
  }

  function info() {
    return {
      ready: readyFlag,
      model: loaded.model,
      device: loaded.device,
      dtype: loaded.dtype,
      mode: loaded.mode,
      runtime: runtimeUrl(),
      version: VERSION,
    };
  }

  /**
   * Load the model. Idempotent: concurrent calls share one download.
   * Resolves to `info()`. Call `unload()` before switching models.
   */
  function ready(options) {
    const opts = options || {};
    const model = opts.model || MODELS.balanced;
    const dtype = opts.dtype || "q4";

    if (readyFlag) {
      if (loaded.model === model) return Promise.resolve(info());
      return Promise.reject(
        new Error(
          "GamebaseAI is already running " +
            loaded.model +
            "; call GamebaseAI.unload() before switching models."
        )
      );
    }
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      readyFlag = false;

      // Prefer the worker so the UI stays responsive during generation.
      const workerLoad =
        workerBroken
          ? null
          : requestWorker(
              { action: "load", model: model, dtype: dtype, cache: opts.cache !== false },
              { onProgress: opts.onProgress }
            );

      if (workerLoad) {
        try {
          await workerLoad;
          loaded = { model: model, device: "wasm", dtype: dtype, mode: "worker" };
          readyFlag = true;
          return info();
        } catch (error) {
          // A worker crash can be recovered from on the main thread. A model
          // load failure should surface: retrying locally repeats the download.
          if (!workerBroken) throw error;
        }
      }

      try {
        await loadLocally(model, dtype, opts);
      } catch (error) {
        generator = null;
        throw new Error("GamebaseAI could not load " + model + ": " + errorMessage(error));
      }
      loaded = { model: model, device: "wasm", dtype: dtype, mode: "main" };
      readyFlag = true;
      return info();
    })();

    return loadingPromise.finally(() => {
      loadingPromise = null;
    });
  }

  /**
   * Generate a chat completion. `messages` is an array of
   * `{role: "system"|"user"|"assistant", content}`. `system` is a convenience
   * shorthand. Resolves to the assistant text.
   *
   * Pass `onToken` to stream: it receives text chunks as they are generated.
   */
  async function chat(options) {
    const opts = options || {};
    if (!readyFlag) {
      await ready({ model: opts.model, onProgress: opts.onProgress });
    }
    if (!readyFlag) {
      throw new Error("GamebaseAI has no model loaded.");
    }

    if (loaded.mode === "worker") {
      const result = await requestWorker(
        {
          action: "chat",
          system: opts.system,
          messages: opts.messages,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          topP: opts.topP,
          repetitionPenalty: opts.repetitionPenalty,
        },
        { onToken: opts.onToken }
      );
      if (!result) throw new Error("GamebaseAI worker is unavailable.");
      const text = (result.text || "").trim();
      if (!text) throw new Error("GamebaseAI produced an empty response.");
      return text;
    }

    if (!generator) {
      throw new Error("GamebaseAI has no model loaded.");
    }
    const text = await chatLocally(opts);
    if (!text) throw new Error("GamebaseAI produced an empty response.");
    return text;
  }

  /** Drop the model so another one can be loaded (or to free memory). */
  function unload() {
    if (loaded.mode === "worker" && worker) {
      try {
        worker.postMessage({ action: "unload", id: ++workerSequence });
      } catch (error) {
        /* ignore */
      }
    }
    if (generator && typeof generator.dispose === "function") {
      try {
        generator.dispose();
      } catch (error) {
        /* ignore dispose failures */
      }
    }
    generator = null;
    loaded = { model: null, device: null, dtype: null, mode: null };
    readyFlag = false;
    loadingPromise = null;
  }

  global.GamebaseAI = {
    version: VERSION,
    models: MODELS,
    defaultModel: MODELS.balanced,
    ready,
    chat,
    isReady,
    info,
    unload,
  };
})(typeof window !== "undefined" ? window : globalThis);
