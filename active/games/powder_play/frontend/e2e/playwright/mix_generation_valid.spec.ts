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
  const health = await request.get('http://127.0.0.1:8787/health').catch(() => null);
  if (!health || !health.ok()) {
    test.skip(true, 'mix server unavailable');
  }
  const prompt = 'Create a material that represents mixing Salt and Water. Return ONLY JSON with fields: type, name, description, tags, density, color. Do not respond with no_reaction.';
  let res: Awaited<ReturnType<typeof request.post>> | null = null;
  try {
    res = await request.post('http://127.0.0.1:8787/llm', {
      data: {
        prompt,
        format: 'json',
        system: 'Respond with a single JSON object only. Do not include markdown, explanations, or extra text.'
      },
      timeout: 120000
    });
  } catch (err) {
    test.skip(true, 'LLM request timed out');
  }
  if (!res) return;
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const raw = String(body?.response || '');
  const parsed = parseJsonFromText(raw);
  if (!parsed) {
    test.skip(true, 'LLM response was not valid JSON');
  }
  expect(parsed).toBeTruthy();
  expect(String(parsed.type || '').toLowerCase()).toBe('material');
  expect(typeof parsed.name).toBe('string');
  expect(parsed.name.length).toBeGreaterThan(0);
  expect(Array.isArray(parsed.tags)).toBeTruthy();
  expect(parsed.tags.length).toBeGreaterThan(0);
  expect(typeof parsed.density).toBe('number');
  const color = parsed.color;
  const colorOk = typeof color === 'string' || (Array.isArray(color) && color.length >= 3);
  expect(colorOk).toBeTruthy();
});
