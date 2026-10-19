/*
 * GamebaseAI worker — runs CPU inference off the game's main thread.
 *
 * Loading this as a module worker keeps the DOM responsive while a model
 * generates, so token callbacks actually paint. The main-thread service falls
 * back to in-page inference if workers are unavailable (e.g. a strict sandbox).
 */

let pipeline = null;
let runtime = null;

function post(message) {
  self.postMessage(message);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

async function getRuntime(url) {
  if (!runtime) runtime = await import(url);
  return runtime;
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

async function handleLoad(message) {
  const { id, model, dtype, runtimeUrl, cache } = message;
  try {
    const transformers = await getRuntime(runtimeUrl);
    const env = transformers.env;
    env.allowLocalModels = false;
    env.useBrowserCache = cache !== false;

    pipeline = await transformers.pipeline("text-generation", model, {
      device: "wasm",
      dtype,
      progress_callback: (report) => {
        post({
          id,
          type: "progress",
          progress: report && typeof report.progress === "number" ? report.progress / 100 : null,
          file: (report && report.file) || null,
          status: (report && report.status) || null,
        });
      },
    });

    post({ id, type: "done", info: { ready: true, model, device: "wasm", dtype } });
  } catch (error) {
    pipeline = null;
    post({ id, type: "error", error: "Could not load " + model + ": " + errorMessage(error) });
  }
}

async function handleChat(message) {
  const { id } = message;
  if (!pipeline) {
    post({ id, type: "error", error: "No model loaded" });
    return;
  }
  try {
    const transformers = await getRuntime(message.runtimeUrl);
    const messages = [];
    if (message.system) messages.push({ role: "system", content: String(message.system) });
    (message.messages || []).forEach((entry) => {
      if (entry && entry.role && typeof entry.content === "string") {
        messages.push({ role: entry.role, content: entry.content });
      }
    });

    let streamed = "";
    const streamer = new transformers.TextStreamer(pipeline.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk) => {
        streamed += chunk;
        post({ id, type: "token", token: chunk });
      },
    });

    const output = await pipeline(messages, {
      max_new_tokens: message.maxTokens || 96,
      do_sample: message.temperature !== 0,
      temperature: message.temperature == null ? 0.8 : message.temperature,
      top_p: message.topP == null ? 0.9 : message.topP,
      repetition_penalty:
        message.repetitionPenalty == null ? 1.1 : message.repetitionPenalty,
      return_full_text: false,
      streamer,
    });

    const text = (streamed || extractText(output)).trim();
    if (!text) {
      post({ id, type: "error", error: "Empty response" });
      return;
    }
    post({ id, type: "done", text });
  } catch (error) {
    post({ id, type: "error", error: errorMessage(error) });
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.action === "load") {
    handleLoad(message);
  } else if (message.action === "chat") {
    handleChat(message);
  } else if (message.action === "unload") {
    pipeline = null;
    post({ id: message.id, type: "done" });
  }
};
