import { test, expect } from '@playwright/test';

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
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

test('ollama returns valid material JSON for mix prompt', async ({ request }) => {
  test.setTimeout(120000);
  const prompt = 'Create a material that represents mixing Salt and Water. Return ONLY JSON with fields: type, name, description, primitives (non-empty array of ops), budgets. Do not respond with no_reaction.';
  const res = await request.post('http://127.0.0.1:8787/llm', {
    data: { prompt },
    timeout: 120000
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const raw = String(body?.response || '');
  const parsed = parseJsonFromText(raw);
  expect(parsed).toBeTruthy();
  expect(parsed.type).toBe('material');
  expect(typeof parsed.name).toBe('string');
  expect(parsed.name.length).toBeGreaterThan(0);
  expect(Array.isArray(parsed.primitives)).toBeTruthy();
  expect(parsed.primitives.length).toBeGreaterThan(0);
  const op = parsed.primitives[0];
  expect(typeof op?.op).toBe('string');
  expect(parsed.budgets).toBeTruthy();
});
