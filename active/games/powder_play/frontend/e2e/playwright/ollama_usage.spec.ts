import { test, expect } from '@playwright/test';

test('ollama backend responds for mix generation', async ({ request }) => {
  const namePrompt = 'Return only JSON {"name":"OllamaTest"}.';
  const nameRes = await request.post('http://127.0.0.1:8787/llm', {
    data: { prompt: namePrompt }
  });
  expect(nameRes.ok()).toBeTruthy();
  const nameBody = await nameRes.json();
  expect(typeof nameBody.response).toBe('string');
  expect(nameBody.response.length).toBeGreaterThan(0);

  const materialPrompt = 'Return JSON for a material named "OllamaTest" with primitives and budgets.';
  const materialRes = await request.post('http://127.0.0.1:8787/llm', {
    data: { prompt: materialPrompt }
  });
  expect(materialRes.ok()).toBeTruthy();
  const materialBody = await materialRes.json();
  expect(typeof materialBody.response).toBe('string');
  expect(materialBody.response.length).toBeGreaterThan(0);
});
