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
 * Load it from a game (classic script, no build step):
 *
 *   <script src="/static/services/ai.js"></script>
 *
 *   const info = await GamebaseAI.ready({
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

  const VERSION = "1.0.0";
  const DEFAULT_RUNTIME_URL =
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";

  // Small, CPU-friendly chat models that ship q4 ONNX weights.
  const MODELS = Object.freeze({
    fast: "HuggingFaceTB/SmolLM2-135M-Instruct",
    balanced: "HuggingFaceTB/SmolLM2-360M-Instruct",
    sharp: "onnx-community/Qwen2.5-0.5B-Instruct",
  });

  let runtimePromise = null;
  let generator = null;
  let loaded = { model: null, device: null, dtype: null };
  let loadingPromise = null;

  function runtimeUrl() {
    return global.GAMEBASE_AI_RUNTIME || DEFAULT_RUNTIME_URL;
  }

  function loadRuntime() {
    if (!runtimePromise) {
      const url = runtimeUrl();
      runtimePromise = import(url).catch((error) => {
        runtimePromise = null;
        const detail = error && error.message ? error.message : String(error);
        throw new Error(
          "GamebaseAI could not load its runtime from " +
            url +
            " (" +
            detail +
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

  function isReady() {
    return Boolean(generator);
  }

  function info() {
    return {
      ready: isReady(),
      model: loaded.model,
      device: loaded.device,
      dtype: loaded.dtype,
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

    if (generator) {
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
      const transformers = await loadRuntime();
      const env = transformers.env;
      env.allowLocalModels = false;
      env.useBrowserCache = opts.cache === false ? false : canUseBrowserCache();

      const progress_callback = (report) => {
        if (typeof opts.onProgress !== "function") return;
        const progress =
          report && typeof report.progress === "number" ? report.progress / 100 : null;
        opts.onProgress({
          model,
          progress,
          file: (report && report.file) || null,
          status: (report && report.status) || null,
        });
      };

      try {
        generator = await transformers.pipeline("text-generation", model, {
          device: "wasm",
          dtype,
          progress_callback,
        });
      } catch (error) {
        generator = null;
        const detail = error && error.message ? error.message : String(error);
        throw new Error("GamebaseAI could not load " + model + ": " + detail);
      }

      loaded = { model, device: "wasm", dtype };
      return info();
    })();

    return loadingPromise.finally(() => {
      loadingPromise = null;
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

  /**
   * Generate a chat completion. `messages` is an array of
   * `{role: "system"|"user"|"assistant", content}`. `system` is a convenience
   * shorthand. Resolves to the assistant text.
   *
   * Pass `onToken` to stream: it receives text chunks as they are generated.
   */
  async function chat(options) {
    const opts = options || {};
    if (!generator) {
      await ready({ model: opts.model, onProgress: opts.onProgress });
    }
    if (!generator) {
      throw new Error("GamebaseAI has no model loaded.");
    }

    const transformers = await loadRuntime();
    const messages = [];
    if (opts.system) messages.push({ role: "system", content: String(opts.system) });
    (opts.messages || []).forEach((message) => {
      if (message && message.role && typeof message.content === "string") {
        messages.push({ role: message.role, content: message.content });
      }
    });

    const onToken = typeof opts.onToken === "function" ? opts.onToken : null;
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
      max_new_tokens: opts.maxTokens || 96,
      do_sample: opts.temperature !== 0,
      temperature: opts.temperature == null ? 0.8 : opts.temperature,
      top_p: opts.topP == null ? 0.9 : opts.topP,
      repetition_penalty: opts.repetitionPenalty == null ? 1.1 : opts.repetitionPenalty,
      return_full_text: false,
    };
    if (streamer) generateOptions.streamer = streamer;

    const output = await generator(messages, generateOptions);
    const text = (streamed || extractText(output)).trim();
    if (!text) throw new Error("GamebaseAI produced an empty response.");
    return text;
  }

  /** Drop the model so another one can be loaded (or to free memory). */
  function unload() {
    if (generator && typeof generator.dispose === "function") {
      try {
        generator.dispose();
      } catch (error) {
        /* ignore dispose failures */
      }
    }
    generator = null;
    loaded = { model: null, device: null, dtype: null };
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
