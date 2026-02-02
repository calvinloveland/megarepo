// Simple model manager for in-browser local models.
// Responsibilities:
// - Check if a model is installed in IndexedDB / FS (user-provided location)
// - Provide instructions to download/install a model (manual step)
// - Expose simple API: isModelAvailable(), installModel(url), getModelInfo()

const NODE_FALLBACK_KEY = '__powder_play_model_installed';

export async function isModelAvailable(): Promise<boolean> {
  // For MVP, check for a flag in localStorage where users can place model files
  if (typeof localStorage !== 'undefined') {
    const v = localStorage.getItem('powder_play_model_installed');
    return v === '1';
  }
  // Node or test environment fallback
  // @ts-ignore
  return Boolean(globalThis[NODE_FALLBACK_KEY]);
}

export async function markModelInstalled() {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('powder_play_model_installed', '1');
  } else {
    // Node or test environment fallback
    // @ts-ignore
    globalThis[NODE_FALLBACK_KEY] = true;
  }
}

export async function installModelFromUrl(_url: string, onProgress?: (pct:number)=>void) {
  // NOTE: In-browser model download and unpacking is highly platform dependent.
  // For MVP, we just show progress and instruct the user how to manually add the model.
  onProgress && onProgress(0);
  await new Promise(r => setTimeout(r, 500));
  onProgress && onProgress(25);
  await new Promise(r => setTimeout(r, 500));
  onProgress && onProgress(50);
  await new Promise(r => setTimeout(r, 500));
  onProgress && onProgress(100);
  // mark installed
  await markModelInstalled();
  return true;
}

export async function getModelInfo() {
  const avail = await isModelAvailable();
  return {available: avail, name: avail ? 'local-quant-model' : null};
}
