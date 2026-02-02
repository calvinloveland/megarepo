import { test, expect } from '@playwright/test';

test('ollama backend responds for mix generation', async ({ request }) => {
  test.setTimeout(180000);
  const namePrompt = 'Return only JSON {"name":"OllamaTest"}.';
  const nameRes = await request.post('http://127.0.0.1:8787/llm', {
    data: { prompt: namePrompt },
    timeout: 180000
  });
  expect(nameRes.ok()).toBeTruthy();
  const nameBody = await nameRes.json();
  expect(typeof nameBody.response).toBe('string');
  expect(nameBody.response.length).toBeGreaterThan(0);
});
