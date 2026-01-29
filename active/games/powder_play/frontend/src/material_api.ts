function parseJsonFromText(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // fall through
  }
  const start = text.indexOf('{');
  if (start === -1) return null;
  for (let i = start; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (depth === 0) {
        const snippet = text.slice(i, j + 1);
        try {
          return JSON.parse(snippet);
        } catch (e) {
          break;
        }
      }
    }
  }
  return null;
}

// Frontend-local LLM API (Ollama via mix server proxy)
export async function runLocalLLM(intent: string, onProgress?: (p:any)=>void) {
  const globalAny = globalThis as any;
  const envBase = typeof process !== 'undefined' ? process.env.POWDER_PLAY_MIX_API_BASE : undefined;
  const base = globalAny.__mixApiBase
    || envBase
    || (typeof window !== 'undefined' && window.location?.hostname
      ? `${window.location.protocol}//${window.location.hostname}:8787`
      : 'http://127.0.0.1:8787');
  onProgress && onProgress({stage:'generating', message:'ollama'});
  const res = await fetch(`${base}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: intent,
      format: 'json',
      system: 'Respond with a single JSON object only. Do not include markdown, explanations, or extra text.'
    })
  });
  if (!res.ok) {
    throw new Error(`llm request failed: ${res.status}`);
  }
  const payload = await res.json();
  const text = String(payload?.response || '').trim();
  const parsed = parseJsonFromText(text);
  if (parsed) return parsed;
  return text;
}

export async function runLocalLLMText(intent: string, onProgress?: (p:any)=>void) {
  const globalAny = globalThis as any;
  const envBase = typeof process !== 'undefined' ? process.env.POWDER_PLAY_MIX_API_BASE : undefined;
  const base = globalAny.__mixApiBase
    || envBase
    || (typeof window !== 'undefined' && window.location?.hostname
      ? `${window.location.protocol}//${window.location.hostname}:8787`
      : 'http://127.0.0.1:8787');
  onProgress && onProgress({stage:'generating', message:'ollama'});
  const res = await fetch(`${base}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: intent,
      format: 'text',
      system: 'Respond with a single line of plain text only. Do not include JSON, markdown, or extra commentary.'
    })
  });
  if (!res.ok) {
    throw new Error(`llm request failed: ${res.status}`);
  }
  const payload = await res.json();
  return String(payload?.response || '').trim();
}

export async function installModelFromUrl(_url:string, onProgress?: (pct:number)=>void) {
  onProgress && onProgress(0);
  await new Promise(r=>setTimeout(r,200)); onProgress && onProgress(50);
  await new Promise(r=>setTimeout(r,200)); onProgress && onProgress(100);
  return true;
}
