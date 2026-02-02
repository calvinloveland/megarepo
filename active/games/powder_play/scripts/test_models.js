const fetch = require('node-fetch');

const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';

async function listModels() {
  for (const path of ['/models', '/api/models']) {
    try {
      const r = await fetch(`${OLLAMA}${path}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j)) return j.map(m=>m.name || m.id || m.model || m);
      if (Array.isArray(j.models)) return j.models.map(m=>m.name || m.id || m.model || m);
    } catch (e) {}
  }
  return null;
}

function prompts(a, b) {
  return {
    tags: `Provide a short comma-separated list of tags for a new material produced by mixing ${a} and ${b}. Return only tags.`,
    density: `Provide a single numeric density for a new material produced by mixing ${a} and ${b}. Return only the number.`,
    color: `Provide a single RGB array like [R,G,B] for the new material produced by mixing ${a} and ${b}. Return only the array.`,
    name: `Return a single short name (one or two words) for the material from mixing ${a} and ${b}. Return only the name.`,
    description: `Provide a one-sentence description for the material produced by mixing ${a} and ${b}. Return only the sentence.`,
    json: `Create a material that represents mixing ${a} and ${b}. Return ONLY JSON with fields: type (\"material\"), name (string), description (string), tags (array), density (number), color (array of 3 integers). Return a single JSON object with no surrounding text or markdown.`
  };
}

async function callGenerate(model, prompt, tokens=20, temp=0.2) {
  const payload = {
    model,
    prompt,
    stream: false,
    options: { num_predict: tokens, temperature: temp }
  };
  const start = Date.now();
  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload), timeout: 60000
    });
    const dur = Date.now()-start;
    if (!res.ok) {
      const txt = await res.text().catch(()=>null);
      return { ok: false, dur, status: res.status, body: txt };
    }
    const j = await res.json();
    return { ok: true, dur, body: String(j?.response || '') };
  } catch (err) {
    return { ok: false, dur: Date.now()-start, err: String(err) };
  }
}

function parseDensity(text) {
  if (!text) return null;
  const m = text.match(/[-+]?[0-9]*\.?[0-9]+/);
  if (!m) return null;
  const v = Number(m[0]);
  return isNaN(v) ? null : v;
}
function parseTags(text) {
  if (!text) return [];
  return text.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
}
function parseColor(text) {
  if (!text) return null;
  try { const j = JSON.parse(text); if (Array.isArray(j) && j.length>=3) return j.slice(0,3).map(Number); } catch (e) {}
  const m = text.match(/\d+/g);
  if (m && m.length>=3) return [Number(m[0]), Number(m[1]), Number(m[2])];
  return null;
}

async function testModel(model, trials=5) {
  const a='Salt', b='Water';
  const p = prompts(a,b);
  const propertyKeys = ['tags','density','color','description','name'];
  const propResults = {};
  for (const k of propertyKeys) propResults[k] = [];

  // per-property tests
  for (let t=0;t<trials;t++) {
    for (const k of propertyKeys) {
      const tokens = k==='tags'?12: (k==='density'?8: (k==='color'?12: 16));
      const r = await callGenerate(model, p[k], tokens, 0.2);
      const val = r.ok ? r.body : null;
      let ok = false;
      if (r.ok) {
        if (k==='density') ok = parseDensity(val)!==null;
        else if (k==='tags') ok = parseTags(val).length>0;
        else if (k==='color') ok = parseColor(val)!==null;
        else ok = !!String(val).trim();
      }
      propResults[k].push({ dur: r.dur, ok, raw: val, meta: r });
      process.stdout.write('.');
    }
  }
  process.stdout.write('\n');

  // single-shot JSON tests
  const jsonResults=[];
  for (let t=0;t<trials;t++) {
    const r = await callGenerate(model, p.json, 80, 0.2);
    let ok = false; let parsed = null;
    if (r.ok) {
      try {
        const txt = String(r.body || '');
        const start = txt.indexOf('{');
        const end = txt.lastIndexOf('}');
        if (start!==-1 && end>start) parsed = JSON.parse(txt.slice(start,end+1));
      } catch (e) { parsed = null }
      if (parsed) {
        ok = parsed.type && Array.isArray(parsed.tags) && parsed.tags.length>0 && typeof parsed.density==='number';
      }
    }
    jsonResults.push({ dur: r.dur, ok, raw: r.body, parsed });
    process.stdout.write('J');
  }
  process.stdout.write('\n');

  return { model, propResults, jsonResults };
}

(async ()=>{
  const models = await listModels();
  if (!models) {
    console.error('Could not list models from Ollama; provide model names via env OLLAMA_MODELS comma-separated');
    const env = (process.env.OLLAMA_MODELS||'').split(',').map(s=>s.trim()).filter(Boolean);
    if (!env.length) process.exit(1);
    for (const m of env) {
      console.log('Testing model', m);
      const r = await testModel(m, 3);
      console.log(JSON.stringify(r, null, 2));
    }
    return;
  }

  console.log('available models:', models.join(', '));
  // choose smaller subset (top N)
  const toTest = models.slice(0, Math.min(models.length, 6));
  for (const m of toTest) {
    console.log('\n=== Testing', m, '===');
    const res = await testModel(m, 4);
    // summarize results
    for (const k of Object.keys(res.propResults)) {
      const arr = res.propResults[k];
      const avg = arr.reduce((a,b)=>a+b.dur,0)/arr.length;
      const okCount = arr.filter(x=>x.ok).length;
      console.log(`${k}: ${okCount}/${arr.length} ok, avg ${Math.round(avg)}ms`);
    }
    const jsonOk = res.jsonResults.filter(x=>x.ok).length;
    const jsonAvg = res.jsonResults.reduce((a,b)=>a+b.dur,0)/res.jsonResults.length;
    console.log(`json: ${jsonOk}/${res.jsonResults.length} ok, avg ${Math.round(jsonAvg)}ms`);
  }

})();
