function parseJsonFromText(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // fall through
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const snippet = text.slice(start, end + 1);
  try {
    return JSON.parse(snippet);
  } catch (e) {
    return null;
  }
}

// Frontend-local LLM API (Ollama via mix server proxy)
export async function runLocalLLM(intent: string, onProgress?: (p:any)=>void) {
  const base = (window as any).__mixApiBase || 'http://127.0.0.1:8787';
  onProgress && onProgress({stage:'generating', message:'ollama'});
  const res = await fetch(`${base}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: intent })
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

export async function installModelFromUrl(_url:string, onProgress?: (pct:number)=>void) {
  onProgress && onProgress(0);
  await new Promise(r=>setTimeout(r,200)); onProgress && onProgress(50);
  await new Promise(r=>setTimeout(r,200)); onProgress && onProgress(100);
  return true;
}
