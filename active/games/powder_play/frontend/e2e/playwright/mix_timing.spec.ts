import { test, expect } from '@playwright/test';

// Trigger several random mixes and collect measured timings from the frontend
test('collect mix generation timings', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Alchemist Powder');

  // capture console & page errors early so we can inspect crashes
  const logs: any[] = [];
  page.on('console', (m) => logs.push({ type: 'console', text: m.text() }));
  page.on('pageerror', (err) => logs.push({ type: 'pageerror', error: String(err) }));

  await page.waitForFunction(() => (window as any).__mixCacheReady === true, null, { timeout: 60000 });

  const mats = await page.evaluate(async () => {
    const r = await fetch('/materials/index.json', { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    return j.materials || [];
  });
  if (!Array.isArray(mats) || mats.length < 2) test.skip(true);

  function randPair() {
    const a = Math.floor(Math.random() * mats.length);
    let b = Math.floor(Math.random() * mats.length);
    while (b === a) b = Math.floor(Math.random() * mats.length);
    return [mats[a].name, mats[b].name];
  }

  // trigger a single mix to validate timing instrumentation
  const [a,b] = randPair();
  await page.evaluate(({a,b}) => {
    (window as any).__initWorkerWithMaterial?.({ type: 'material', name: a, tags: ['sand'], density: 1, color: [200,200,200] });
    (window as any).__initWorkerWithMaterial?.({ type: 'material', name: b, tags: ['flow'], density: 1, color: [200,200,200] });
    (window as any).__triggerMixForNames?.(a,b);
  }, { a, b });

  // wait for timing entry for this pair
  await page.waitForFunction((aName, bName) => {
    const arr = (window as any).__mixGenerationTimings || [];
    return arr.some((t:any)=> t.a === aName && t.b === bName);
  }, a, b, { timeout: 30000 }).catch(()=>null);


  // retrieve timings (guard against page/context closure)
  let timings: any[] = [];
  try {
    timings = await page.evaluate(() => (window as any).__mixGenerationTimings || []);
    console.log('timings collected', timings);
    console.log('collected logs', logs);
  } catch (err) {
    console.log('failed to retrieve timings; page may have closed', String(err));
    console.log('collected logs', logs);
    throw new Error('Failed to collect mix timing data; inspect logs for details');
  }

  expect(Array.isArray(timings)).toBeTruthy();
  expect(timings.length).toBeGreaterThanOrEqual(1);
});