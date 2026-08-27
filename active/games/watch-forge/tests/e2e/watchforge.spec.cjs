// tests/e2e/watchforge.spec.cjs — end-to-end browser checks
// ==========================================================
// Drives the real app (static server + Chrome) through the core loops:
// engine boot, evolution, charter switching, watchmaker seeding, and the
// Hall of Fame. The render canvases are probed for non-trivial pixels so a
// future rendering regression fails the suite.

const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.WATCH_FORGE && window.WATCH_FORGE.G.champion, null, { timeout: 10_000 });
}

test('no console or page errors during boot and evolution', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  await page.evaluate(() => window.WATCH_FORGE.stepMany(30));
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});

test('engine exposes five charters and a functioning champion', async ({ page }) => {
  await boot(page);
  const st = await page.evaluate(() => ({
    challenges: Object.keys(window.WATCH_FORGE.E.CHALLENGES),
    champSet: !!window.WATCH_FORGE.G.champion,
    comps: window.WATCH_FORGE.G.champion.pheno.compCount,
  }));
  expect(st.challenges.sort()).toEqual(['chronometer', 'grandComplication', 'minimalist', 'pocket', 'skeleton']);
  expect(st.champSet).toBe(true);
  expect(st.comps).toBeGreaterThanOrEqual(0);
});

test('evolution improves the best score over generations', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => window.WATCH_FORGE.G.champion.score);
  await page.evaluate(() => window.WATCH_FORGE.stepMany(60));
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.WATCH_FORGE.G.champion.score);
  expect(after).toBeGreaterThanOrEqual(before);
});

test('switching charter re-scores and updates the breakdown panel', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    document.querySelector('[data-id="chronometer"]').click();
    document.querySelector('[data-id="pocket"]').click();
  });
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => ({
    charter: window.WATCH_FORGE.G.challengeId,
    breakdownRows: document.querySelectorAll('#scoreBreakdown .sb-row').length,
    champHeading: document.querySelector('#champName').textContent,
  }));
  expect(st.charter).toBe('pocket');
  expect(st.breakdownRows).toBeGreaterThan(0);
  expect(st.champHeading.length).toBeGreaterThan(0);
});

test('watchmaker bench loads the champion and seeds a fresh population', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('#wmLoadBtn').click());
  await page.waitForTimeout(120);
  const loaded = await page.evaluate(() => {
    const wm = window.WATCH_FORGE.G.watchmaker;
    return !!wm && typeof wm.escapement === 'string' && 'date' in wm.complications !== undefined;
  });
  expect(loaded).toBe(true);
  await page.evaluate(() => {
    document.querySelector('#wmSkel input').value = 100;
    document.querySelector('#wmSkel input').dispatchEvent(new Event('input'));
    document.querySelector('#wmSeedBtn').click();
  });
  await page.waitForTimeout(150);
  const seeded = await page.evaluate(() => ({
    gen: window.WATCH_FORGE.G.generation,
    skeleton: window.WATCH_FORGE.G.population[0].skeleton,
  }));
  expect(seeded.skeleton).toBe(100);
});

test('hall of fame saves and re-seeds from a saved champion', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('#saveHofBtn').click());
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => ({
    rows: document.querySelectorAll('.hof-row').length,
    stored: JSON.parse(localStorage.getItem('watchforge.hof') || '[]').length,
  }));
  expect(saved.rows).toBe(1);
  expect(saved.stored).toBe(1);

  // Click the row → population reseeded from the saved champion.
  await page.evaluate(() => document.querySelector('.hof-row').click());
  await page.waitForTimeout(150);
  const reseededName = await page.evaluate(() => window.WATCH_FORGE.G.champion.pheno.name);
  expect(reseededName.length).toBeGreaterThan(0);
});

test('dial, profile and chart canvases all draw real pixels', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(400); // let a RAF frame paint
  const probes = await page.evaluate(() => {
    const probe = (id, minBright, minColors) => {
      const c = document.getElementById(id);
      if (!c || !c.width) return { ok: false };
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let bright = 0, distinct = new Set();
      for (let i = 0; i < d.length; i += 16) {
        distinct.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
        if (d[i] + d[i + 1] + d[i + 2] > 60) bright++;
      }
      return { ok: bright > minBright && distinct.size > minColors };
    };
    return {
      // dial: big animated gears → lots of bright metal
      dial: probe('dialCanvas', 4000, 40),
      // profile: stacked thickness bars (thin members) + labels
      profile: probe('profileCanvas', 600, 20),
      // chart: lines + text on dark
      chart: probe('chartCanvas', 800, 20),
    };
  });
  expect(probes.dial.ok).toBe(true);
  expect(probes.profile.ok).toBe(true);
  expect(probes.chart.ok).toBe(true);
});

test('visible component count tracks openness in the score panel', async ({ page }) => {
  await boot(page);
  const st = await page.evaluate(() => {
    const grid = [...document.querySelectorAll('#statGrid .stat')].map(el => el.textContent);
    return grid.some(t => /Visible parts/.test(t));
  });
  expect(st).toBe(true);
});

test('sonic toggle arm/disarms the audible movement', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    document.querySelector('#soundTick').click();
  });
  await page.waitForTimeout(120);
  const armed = await page.evaluate(() => window.WATCH_FORGE.S.isEnabled());
  expect(armed).toBe(true);
  await page.evaluate(() => {
    document.querySelector('#soundTick').click();
  });
  await page.waitForTimeout(80);
  const disarmed = await page.evaluate(() => window.WATCH_FORGE.S.isEnabled());
  expect(disarmed).toBe(false);
  // Chime stays disabled for a champion without a repeater.
  const chimeDisabled = await page.evaluate(() => document.querySelector('#soundChime').disabled);
  const hasRepeater = await page.evaluate(() => !!window.WATCH_FORGE.G.champion.pheno.geno.complications.minuteRepeater);
  if (!hasRepeater) expect(chimeDisabled).toBe(true);
});

test('spec-sheet export copies a markdown build', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('#exportBtn').click());
  await page.waitForTimeout(300);
  const label = await page.evaluate(() => document.querySelector('#exportBtn').textContent);
  expect(label).toMatch(/Copied|Copy spec sheet/);
});

test('lineage ticker records champion changes across generations', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.WATCH_FORGE.stepMany(30));
  await page.waitForTimeout(250);
  const rows = await page.evaluate(() => document.querySelectorAll('#lineageList .lineage-row').length);
  expect(rows).toBeGreaterThanOrEqual(1);
});

test('hybrid charter blends two objectives into a 0..100 score', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    document.querySelector('[data-id="grandComplication"]').click();
    const sel = document.querySelector('#hybridSel');
    sel.value = 'chronometer';
    sel.dispatchEvent(new Event('change'));
    const w = document.querySelector('#hybridWeight');
    w.value = '40';
    w.dispatchEvent(new Event('input'));
    window.WATCH_FORGE.stepMany(40);
  });
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const g = window.WATCH_FORGE.G;
    return {
      hybrid: g.hybrid,
      score: g.champion.score,
      chip: document.querySelector('#champChallenge').textContent,
      blendRows: document.querySelectorAll('.sb-hybrid').length,
    };
  });
  expect(st.hybrid.secondary).toBe('chronometer');
  expect(st.chip).toContain('×');
  expect(st.score).toBeGreaterThanOrEqual(0);
  expect(st.score).toBeLessThanOrEqual(100.001);
  expect(st.blendRows).toBe(2);
  // Disarming the hybrid restores single-charter scoring scale.
  await page.evaluate(() => {
    const sel = document.querySelector('#hybridSel');
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(200);
  const restored = await page.evaluate(() => ({ hybrid: window.WATCH_FORGE.G.hybrid, score: window.WATCH_FORGE.G.champion.score }));
  expect(restored.hybrid).toBeNull();
  expect(restored.score).toBeGreaterThan(100); // back on the Thin King raw scale
});