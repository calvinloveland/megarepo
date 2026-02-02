import { test } from '@playwright/test';

function parseJsonFromText(text: string) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

function validateMixObject(obj: any) {
  if (!obj || typeof obj !== 'object') return false;
  if (String(obj.type || '').toLowerCase() !== 'material') return false;
  if (!obj.name || typeof obj.name !== 'string') return false;
  if (!Array.isArray(obj.tags) || obj.tags.length === 0) return false;
  if (typeof obj.density !== 'number') return false;
  if (!obj.color) return false;
  if (typeof obj.color === 'string') return true;
  if (Array.isArray(obj.color) && obj.color.length >= 3) return true;
  return false;
}

// Prompt builders
function singleJsonPrompt(a: string, b: string) {
  return `Create a material that represents mixing ${a} and ${b}. Return ONLY JSON with fields: type (\"material\"), name (string), description (string), tags (array), density (number), color (array of 3 integers). Return a single JSON object with no surrounding text or markdown.`;
}
function exampleJsonPrompt(a: string, b: string) {
  return `Examples:\nSalt+Water={"type":"material","name":"SaltWater","description":"Salty water","tags":["water","salty"],"density":1.0,"color":[120,140,160]}\nOil+Water={"type":"material","name":"Emulsion","description":"Oil droplets suspended in water","tags":["water","oil","suspension"],"density":0.95,"color":[200,180,120]}\nNow: Create a material for mixing ${a} and ${b}. Return ONLY JSON as a single object with fields: type, name, description, tags, density, color.`;
}

async function perPropertyGenerate(request: any, a: string, b: string, opts: any) {
  // tags
  const tagsPrompt = `Provide a short comma-separated list of tags for a new material produced by mixing ${a} and ${b}. Examples: \nSaltWater: water,salty\nBouncyGoo: sticky,elastic\nReturn only tags.`;
  const densityPrompt = `Provide a single numeric density for a new material produced by mixing ${a} and ${b}. Return only the number.`;
  const colorPrompt = `Provide a single RGB array like [R,G,B] for the new material produced by mixing ${a} and ${b}. Return only the array.`;
  const namePrompt = `Return a single short name (one or two words) for the material from mixing ${a} and ${b}. Return only the name.`;
  const descPrompt = `Provide a one-sentence description for the material produced by mixing ${a} and ${b}. Return only the sentence.`;

  async function call(prompt: string) {
    const r = await request.post('http://localhost:11434/api/generate', {
      data: {
        model: opts.model || process.env.TEST_MODEL || 'llama3.2',
        prompt: prompt,
        stream: false,
        options: { temperature: opts.temperature || 0.2, num_predict: opts.tokens || 20 }
      },
      timeout: 30000
    }).catch(() => null as any);
    if (!r || !r.ok()) return null;
    const j = await r.json();
    return String(j?.response || '');
  }
  const tagsResp = await call(tagsPrompt);
  const densityResp = await call(densityPrompt);
  const colorResp = await call(colorPrompt);
  const nameResp = await call(namePrompt);
  const descResp = await call(descPrompt);

  if (!tagsResp || !densityResp || !colorResp || !nameResp) return null;
  // basic parsing
  const tags = tagsResp.split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean);
  const density = Number((densityResp.match(/[-0-9.]+/) || [])[0] || NaN);
  let colorArr = null;
  try { colorArr = JSON.parse(colorResp); } catch (e) { /* try parse numbers */
    const nums = colorResp.match(/\d+/g);
    if (nums && nums.length >= 3) colorArr = [Number(nums[0]), Number(nums[1]), Number(nums[2])];
  }
  const name = String(nameResp).split(/[\n\r]/)[0].trim();
  const desc = descResp ? descResp.trim() : '';

  const out = {
    type: 'material',
    name,
    description: desc || `Auto-generated material of ${a} + ${b}`,
    tags,
    density: isNaN(density) ? 1.0 : density,
    color: colorArr || [180,180,180]
  };
  return out;
}

// Run experiment
test('LLM mix experiment: retries, tokens, prompts', async ({ page, request }) => {
  test.setTimeout(360_000);

  // check ollama availability
  const testOk = await request.post('http://localhost:11434/api/generate', {
    data: { model: process.env.TEST_MODEL || 'llama3.2', prompt: 'hi', stream: false, options: { num_predict: 1 } },
    timeout: 5000
  }).catch(() => null as any);
  if (!testOk || !testOk.ok()) {
    console.log('Ollama not available on localhost:11434; skipping');
    test.skip(true);
    return;
  }

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Alchemist Powder');
  await page.waitForFunction(() => (window as any).__mixCacheReady === true, null, { timeout: 10000 });

  const mats = await page.evaluate(async () => {
    try { const r = await fetch('/materials/index.json', { cache: 'no-store' }); if (!r.ok) return []; const j = await r.json(); return j.materials || []; } catch (e) { return []; }
  });
  if (!Array.isArray(mats) || mats.length < 2) { test.skip(true); return; }

  function randPair() {
    const a = Math.floor(Math.random() * mats.length);
    let b = Math.floor(Math.random() * mats.length);
    while (b === a) b = Math.floor(Math.random() * mats.length);
    return [mats[a].name, mats[b].name];
  }

  const configs = [] as any[];
  const tokensList = [20, 80];
  for (const tokens of tokensList) {
    configs.push({ name: `single_json_${tokens}`, type: 'single', tokens });
    configs.push({ name: `example_json_${tokens}`, type: 'example', tokens });
    configs.push({ name: `per_property_${tokens}`, type: 'per_property', tokens });
  }

  const summary: any = {};
  for (const cfg of configs) summary[cfg.name] = { attempts: 0, successes: 0, details: [] };

  const tries = 3; // reduce to keep experiment quick
  const retries = 1; // single attempt per pair to reduce time

  for (const cfg of configs) {
    console.log('Running config', cfg.name);
    for (let i = 0; i < tries; i++) {
      const [a, b] = randPair();
      let success = false;
      let lastMat = null;
      for (let attempt = 0; attempt < retries && !success; attempt++) {
        let mat = null;
        if (cfg.type === 'single') {
          const prompt = singleJsonPrompt(a, b);
          const r = await request.post('http://localhost:11434/api/generate', {
            data: { model: process.env.TEST_MODEL || 'llama3.2', prompt, stream: false, options: { num_predict: cfg.tokens, temperature: 0.2 } },
            timeout: 60000
          }).catch(() => null as any);
          if (r && r.ok()) {
            const j = await r.json();
            const raw = String(j?.response || '');
            mat = parseJsonFromText(raw);
          }
        } else if (cfg.type === 'example') {
          const prompt = exampleJsonPrompt(a, b);
          const r = await request.post('http://localhost:11434/api/generate', {
            data: { model: process.env.TEST_MODEL || 'llama3.2', prompt, stream: false, options: { num_predict: cfg.tokens, temperature: 0.2 } },
            timeout: 60000
          }).catch(() => null as any);
          if (r && r.ok()) {
            const j = await r.json();
            const raw = String(j?.response || '');
            mat = parseJsonFromText(raw);
          }
        } else if (cfg.type === 'per_property') {
          mat = await perPropertyGenerate(request, a, b, { tokens: cfg.tokens, temperature: 0.2 });
        }
        lastMat = mat;
        if (mat && validateMixObject(mat)) {
          success = true;
          break;
        }
      }
      summary[cfg.name].attempts += 1;
      if (success) {
        summary[cfg.name].successes += 1;
        summary[cfg.name].details.push({ input: [a, b], ok: true, material: lastMat });
      } else {
        summary[cfg.name].details.push({ input: [a, b], ok: false, material: lastMat });
      }
    }
    console.log('Config results', cfg.name, summary[cfg.name].successes, '/', summary[cfg.name].attempts);
  }

  console.log('Experiment summary', summary);

  // Save summary to global for inspection in the browser logs or test artifacts
  (globalThis as any).__mixExperimentSummary = summary;
});