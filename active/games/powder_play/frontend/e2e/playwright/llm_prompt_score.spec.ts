import { test, expect } from '@playwright/test';

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
    name: 'examples-v1',
    namePrompt: (a, b) =>
      `Return ONLY JSON with {"name":"<new material name>"} for mixing ${a} and ${b}. If no reaction, return {"no_reaction": true}. Example valid outputs: {"name":"Glass"} or {"no_reaction": true}.`,
    materialPrompt: (a, b, candidate) =>
      `Return ONLY JSON for a material named "${candidate}" that represents mixing ${a} and ${b}. Required fields: type:"material", name, description, primitives (non-empty array of ops), budgets. No extra text. Example valid output: {"type":"material","name":"${candidate}","description":"...","primitives":[{"op":"read","dx":0,"dy":1},{"op":"if","cond":{"eq":{"value":0}},"then":[{"op":"move","dx":0,"dy":1}]}],"budgets":{"max_ops":8,"max_spawns":0}}.`
  },
  {
    name: 'tight-json-v1',
    namePrompt: (a, b) =>
      `Respond ONLY with a JSON object and nothing else. Schema: {"name":"<string>"} OR {"no_reaction": true}. Mixing ${a} + ${b}.`,
    materialPrompt: (a, b, candidate) =>
      `Respond ONLY with a JSON object and nothing else. Schema: {"type":"material","name":"${candidate}","description":"<string>","primitives":[...],"budgets":{"max_ops":<int>,"max_spawns":<int>}}. This material represents mixing ${a} + ${b}.`
  }
];

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

function isValidNamePayload(obj: any) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.no_reaction === true) return true;
  return typeof obj.name === 'string' && obj.name.trim().length > 0;
}

function isValidMaterialPayload(obj: any) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.no_reaction === true) return true;
  if (obj.type !== 'material') return false;
  if (!obj.name || typeof obj.name !== 'string') return false;
  if (!Array.isArray(obj.primitives) || obj.primitives.length === 0) return false;
  return true;
}

test('llm prompt scoring harness', async () => {
  test.setTimeout(120_000);
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
        nameObj = parseJsonFromText(nameText);
      } catch (e) {
        nameObj = null;
      }
      const nameValid = isValidNamePayload(nameObj);
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

  console.log('LLM prompt scoring results:');
  for (const row of rows) {
    console.log(`${row.prompt} ${row.pair} name=${row.nameValid ? 'ok' : 'bad'} material=${row.materialValid ? 'ok' : 'bad'} score=${row.total}/3`);
  }
  for (const [prompt, score] of Object.entries(summary)) {
    const pct = ((score.total / score.max) * 100).toFixed(1);
    console.log(`${prompt}: ${score.total}/${score.max} (${pct}%)`);
  }

  const best = Math.max(...Object.values(summary).map((s) => s.total));
  expect(rows.length).toBeGreaterThan(0);
});
