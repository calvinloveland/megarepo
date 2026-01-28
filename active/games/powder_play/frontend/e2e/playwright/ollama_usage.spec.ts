import { test, expect } from '@playwright/test';

test('mix generation uses ollama backend', async ({ page }) => {
  let llmCalls = 0;

  await page.addInitScript(() => {
    (window as any).__mixApiBase = 'http://127.0.0.1:8787';
  });

  await page.route('**/mixes', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/mixes/*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
      return;
    }
    const body = route.request().postDataJSON?.() || {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/llm', async (route) => {
    llmCalls += 1;
    if (llmCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: JSON.stringify({ name: 'Testium' }) })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: JSON.stringify({
          type: 'material',
          name: 'Testium',
          description: 'A stable test material.',
          primitives: [{ op: 'read', dx: 0, dy: 1 }],
          budgets: { max_ops: 6, max_spawns: 0 }
        })
      })
    });
  });

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Alchemist Powder');

  const { nameA, nameB } = await page.evaluate(() => {
    const suffix = Date.now().toString();
    const a = { type: 'material', name: `LLMTestA_${suffix}`, description: 'A', primitives: [], budgets: { max_ops: 1, max_spawns: 0 } };
    const b = { type: 'material', name: `LLMTestB_${suffix}`, description: 'B', primitives: [], budgets: { max_ops: 1, max_spawns: 0 } };
    (window as any).__initWorkerWithMaterial?.(a);
    (window as any).__initWorkerWithMaterial?.(b);
    return { nameA: a.name, nameB: b.name };
  });

  await page.evaluate(({ nameA, nameB }) => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    worker.postMessage({ type: 'paint_points', materialId: map[nameA], points: [{ x: 70, y: 70 }] });
    worker.postMessage({ type: 'paint_points', materialId: map[nameB], points: [{ x: 71, y: 70 }] });
    worker.postMessage({ type: 'step' });
  }, { nameA, nameB });

  await page.waitForTimeout(500);
  expect(llmCalls).toBeGreaterThanOrEqual(2);
});
