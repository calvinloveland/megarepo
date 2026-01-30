import { test } from '@playwright/test';

async function perPropertyGenerate(request: any, a: string, b: string, opts: any) {
  const tagsPrompt = `Provide a short comma-separated list of tags for a new material produced by mixing ${a} and ${b}. Return only tags.`;
  const densityPrompt = `Provide a single numeric density for a new material produced by mixing ${a} and ${b}. Return only the number.`;
  const colorPrompt = `Provide a single RGB array like [R,G,B] for the new material produced by mixing ${a} and ${b}. Return only the array.`;
  const namePrompt = `Return a single short name (one or two words) for the material from mixing ${a} and ${b}. Return only the name.`;
  const descPrompt = `Provide a one-sentence description for the material produced by mixing ${a} and ${b}. Return only the sentence.`;

  async function call(prompt: string) {
    const r = await request.post('http://localhost:11434/api/generate', {
      data: { model: opts.model || 'llama3.2', prompt, stream: false, options: { num_predict: opts.tokens || 20, temperature: opts.temperature || 0.2 } },
      timeout: opts.callTimeout || 30000
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
  const tags = tagsResp.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean);
  const density = Number((densityResp.match(/[-0-9.]+/) || [])[0] || NaN);
  let colorArr: number[] | null = null;
  try { colorArr = JSON.parse(colorResp); } catch (e) {
    const nums = colorResp.match(/\d+/g);
    if (nums && nums.length >= 3) colorArr = [Number(nums[0]), Number(nums[1]), Number(nums[2])];
  }
  const name = String(nameResp).split(/[\n\r]/)[0].trim();
  const desc = descResp ? descResp.trim() : '';

  return {
    type: 'material',
    name,
    description: desc || `Auto-generated material of ${a} + ${b}`,
    tags,
    density: isNaN(density) ? 1.0 : density,
    color: colorArr || [180, 180, 180]
  };
}

// Run per-property experiments in parallel across configurations
const tokensList = [20, 80, 160];
const temps = [0.0, 0.2, 0.5];
const tries = 10; // attempts per test

test.describe.parallel('Per-property LLM experiments (parallel)', () => {
  test.setTimeout(30 * 60 * 1000); // 30 minutes

  // Check Ollama before running tests
  test.beforeAll(async ({ request }) => {
    const r = await request.post('http://localhost:11434/api/generate', { data: { model: 'llama3.2', prompt: 'health check', stream: false, options: { num_predict: 1 } }, timeout: 5000 }).catch(() => null as any);
    if (!r || !r.ok()) {
      console.log('Ollama not available locally; skipping per-property experiments');
      test.skip(true);
    }
  });

  for (const tokens of tokensList) {
    for (const temp of temps) {
      const name = `per_property_tokens_${tokens}_temp_${String(temp).replace('.', '_')}`;
      test(name, async ({ page, request }) => {
        // load materials
        await page.goto('http://127.0.0.1:5173/');
        await page.waitForFunction(() => (window as any).__mixCacheReady === true, null, { timeout: 10000 });
        const mats = await page.evaluate(async () => {
          try { const r = await fetch('/materials/index.json', { cache: 'no-store' }); if (!r.ok) return []; const j = await r.json(); return j.materials || []; } catch (e) { return []; }
        });
        if (!Array.isArray(mats) || mats.length < 2) return;

        function randPair() {
          const a = Math.floor(Math.random() * mats.length);
          let b = Math.floor(Math.random() * mats.length);
          while (b === a) b = Math.floor(Math.random() * mats.length);
          return [mats[a].name, mats[b].name];
        }

        const summary = { attempts: 0, successes: 0, details: [] as any[] };

        for (let i = 0; i < tries; i++) {
          const [a, b] = randPair();
          // ensure loaded
          await page.evaluate(({ na, nb }) => { (window as any).__initWorkerWithMaterial?.({ type: 'material', name: na, tags: ['sand'], density: 1, color: [200,200,200] }); (window as any).__initWorkerWithMaterial?.({ type: 'material', name: nb, tags: ['flow'], density: 1, color: [200,200,200] }); }, { na: a, nb: b });
          const mat = await perPropertyGenerate(request, a, b, { tokens, temperature: temp, callTimeout: 30000 });
          summary.attempts++;
          if (mat && mat.name && Array.isArray(mat.tags) && typeof mat.density === 'number' && mat.color) {
            summary.successes++;
            summary.details.push({ input: [a, b], material: mat });
          } else {
            summary.details.push({ input: [a, b], material: null });
          }
        }

        console.log('Experiment', name, 'summary', summary);
        // expose for post-inspection
        (globalThis as any).__perPropertyExperiments = (globalThis as any).__perPropertyExperiments || {};
        (globalThis as any).__perPropertyExperiments[name] = summary;
        // no strict assertion; this is exploratory
      });
    }
  }
});
