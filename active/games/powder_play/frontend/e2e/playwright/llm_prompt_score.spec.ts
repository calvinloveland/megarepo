import { test, expect } from '@playwright/test';
import { createFailureLogger } from './helpers/failure_logger';

type PromptSet = {
  name: string;
  namePrompt: (a: string, b: string) => string;
  materialPrompt: (a: string, b: string, candidate: string) => string;
};

type MixPair = [string, string];

type ScoreRow = {
  prompt: string;
  pair: string;
  nameValid: boolean;
  materialValid: boolean;
  total: number;
};

const mixes: MixPair[] = [
  ['Sand', 'Water'],
  ['Fire', 'Sand']
];

const promptSets: PromptSet[] = [
  {
    name: 'mix-list-v1',
    namePrompt: (a, b) =>
      `Mixes:\nSand+Water=Silt\nFire+Sand=Glass\n${a}+${b}=`,
    materialPrompt: (a, b, candidate) =>
      `Return ONLY JSON for a material named "${candidate}" that represents mixing ${a} and ${b}. Required fields: type:"material", name, tags, density, color. Example valid output: {"type":"material","name":"${candidate}","tags":["flow"],"density":1.2,"color":[120,140,200],"description":"..."}.`
  },
  {
    name: 'mix-list-v2',
    namePrompt: (a, b) =>
      `Mixes:\nSand+Water=Silt\nFire+Sand=Glass\n${a}+${b}=\nReturn only the new material name on the final line.`,
    materialPrompt: (a, b, candidate) =>
      `Respond ONLY with a JSON object. Required keys: type,name,tags,density,color. Name must be "${candidate}". Mixing ${a} and ${b}.`
  }
];

function parseNameFromText(text: string) {
  if (!text) return null as null | {name?: string; no_reaction?: boolean};
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  let last = lines[lines.length - 1];
  if (last.includes('=')) {
    last = last.slice(last.lastIndexOf('=') + 1).trim();
  }
  last = last.replace(/^['"`]+|['"`]+$/g, '').trim();
  if (!last) return null;
  const lower = last.toLowerCase();
  if (lower.includes('no reaction') || lower.includes('no_reaction')) return { no_reaction: true };
  return { name: last };
}

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

function isValidMaterialPayload(obj: any) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.no_reaction === true) return true;
  if (obj.type !== 'material') return false;
  if (!obj.name || typeof obj.name !== 'string') return false;
  if (!Array.isArray(obj.tags) || obj.tags.length === 0) return false;
  if (typeof obj.density !== 'number') return false;
  const color = obj.color;
  const colorOk = typeof color === 'string'
    || (Array.isArray(color) && color.length >= 3 && color.length <= 4);
  if (!colorOk) return false;
  return true;
}

test('llm prompt scoring harness', async ({}, testInfo) => {
  const logger = createFailureLogger(testInfo);
  let failed = false;
  try {
    test.setTimeout(360_000);
    const requestTimeoutMs = 10_000;
    const baseUrl = 'http://127.0.0.1:8787/llm';

  async function postLLM(prompt: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          format: 'json',
          system: 'Respond with a single JSON object only. Do not include markdown, explanations, or extra text.'
        }),
        signal: controller.signal
      });
      const payload = await res.json();
      return String(payload?.response || '').trim();
    } finally {
      clearTimeout(timer);
    }
  }
  const rows: ScoreRow[] = [];
  for (const promptSet of promptSets) {
    for (const [a, b] of mixes) {
      let nameObj: any = null;
      try {
        const nameText = await postLLM(promptSet.namePrompt(a, b));
        nameObj = parseNameFromText(nameText);
      } catch (e) {
        nameObj = null;
      }
      const nameValid = nameObj !== null;
      const candidate = typeof nameObj?.name === 'string' && nameObj.name.trim() ? nameObj.name.trim() : 'TestMix';

      let materialObj: any = null;
      try {
        const materialText = await postLLM(promptSet.materialPrompt(a, b, candidate));
        materialObj = parseJsonFromText(materialText);
      } catch (e) {
        materialObj = null;
      }
      const materialValid = isValidMaterialPayload(materialObj);

      const total = (nameValid ? 1 : 0) + (materialValid ? 2 : 0);
      rows.push({
        prompt: promptSet.name,
        pair: `${a}+${b}`,
        nameValid,
        materialValid,
        total
      });
    }
  }

  const summary: Record<string, { total: number; max: number }> = {};
  for (const row of rows) {
    if (!summary[row.prompt]) summary[row.prompt] = { total: 0, max: 0 };
    summary[row.prompt].total += row.total;
    summary[row.prompt].max += 3;
  }

    logger.log('LLM prompt scoring results:');
    for (const row of rows) {
      logger.log(`${row.prompt} ${row.pair} name=${row.nameValid ? 'ok' : 'bad'} material=${row.materialValid ? 'ok' : 'bad'} score=${row.total}/3`);
    }
    for (const [prompt, score] of Object.entries(summary)) {
      const pct = ((score.total / score.max) * 100).toFixed(1);
      logger.log(`${prompt}: ${score.total}/${score.max} (${pct}%)`);
    }

    const best = Math.max(...Object.values(summary).map((s) => s.total));
    expect(rows.length).toBeGreaterThan(0);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});
