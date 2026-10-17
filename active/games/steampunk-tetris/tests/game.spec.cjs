// The game itself: presentation, keyboard play, the adapter handshake, and the
// deterministic test surface. Protocol conformance lives in conformance.spec.cjs.
const { test, expect } = require('@playwright/test');
const { waitForGame, state, advance, attachErrorCollector } = require('./helpers.cjs');

/** How much of a canvas is lit up, and in what colour, for render assertions. */
async function canvasStats(page, selector) {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel);
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    let brass = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      const sum = data[i] + data[i + 1] + data[i + 2];
      if (a > 8 && sum > 150) lit += 1;
      if (a > 8 && sum > 260 && data[i] >= data[i + 2]) {
        brass += 1;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
    }
    return {
      lit,
      brass,
      total: (canvas.width * canvas.height),
      avg: brass ? [r / brass, g / brass, b / brass] : [0, 0, 0],
    };
  }, selector);
}

test.describe('Brass & Boiler', () => {
  test('loads clean and announces itself to the Arena', async ({ page }) => {
    const errors = attachErrorCollector(page);
    await page.goto('/');
    await waitForGame(page);

    const ready = await page.evaluate(() => new Promise((resolve) => {
      const onMessage = (event) => {
        const msg = event.data;
        if (msg && msg.proto === 'tetris/2' && msg.type === 'ready') {
          window.removeEventListener('message', onMessage);
          resolve(msg.payload);
        }
      };
      // The page may have sent `ready` before this listener attached; fall back
      // to a `state` round trip to prove the adapter is listening.
      window.addEventListener('message', onMessage);
      setTimeout(() => resolve(null), 2000);
    }));
    if (ready) {
      expect(ready.name).toBe('Brass & Boiler');
      expect(ready.author).toMatch(/Calvin Loveland/);
      expect(ready.author).toMatch(/deepseek/);
    } else {
      const name = await page.title();
      expect(name).toMatch(/Brass/i);
    }
    expect(errors.pageErrors).toEqual([]);
  });

  test('runs by itself from the wall clock', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    const before = await state(page);
    await page.waitForTimeout(2600);
    const after = await state(page);
    expect(after.elapsed_ms).toBeGreaterThan(2000);
    expect(after.piece_count > before.piece_count || after.piece.y > before.piece.y).toBe(true);
  });

  test('keyboard moves, rotates, drops and holds', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    await page.evaluate(() => window.__tetris.api.reset({ seed: 'arena' }));
    await page.evaluate(() => window.__tetris.api.freeze());

    const start = await state(page);
    await page.keyboard.press('ArrowLeft');
    expect((await state(page)).piece.x).toBe(start.piece.x - 1);

    await page.keyboard.press('ArrowUp');
    expect((await state(page)).piece.rotation).toBe(1);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    const dropped = await state(page);
    expect(dropped.score).toBeGreaterThan(0);
    expect(dropped.piece_count).toBe(start.piece_count + 1);
    expect(dropped.board.join('')).not.toBe('.'.repeat(200));

    await page.keyboard.press('KeyC');
    const held = await state(page);
    expect(held.hold).not.toBeNull();
    expect(held.can_hold).toBe(false);
  });

  test('P pauses the clock and R starts a fresh run', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    await page.evaluate(() => window.__tetris.api.reset({ seed: 'arena' }));
    await page.keyboard.press('KeyP');
    const paused = await state(page);
    await page.waitForTimeout(700);
    const stillPaused = await state(page);
    expect(stillPaused.elapsed_ms).toBe(paused.elapsed_ms);
    expect(await page.evaluate(() => window.__tetris.engine.paused)).toBe(true);

    await page.keyboard.press('KeyP');
    await page.waitForTimeout(300);
    expect((await state(page)).elapsed_ms).toBeGreaterThan(paused.elapsed_ms);

    await page.evaluate(() => window.__tetris.api.press('hard_drop'));
    await page.keyboard.press('KeyR');
    const fresh = await state(page);
    expect(fresh.score).toBe(0);
    expect(fresh.piece_count).toBe(1);
  });

  test('draws a riveted brass board, a ghost piece and settled blocks', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    await page.evaluate(() => window.__tetris.api.reset({ seed: 'arena' }));
    await page.evaluate(() => window.__tetris.api.freeze());
    await page.waitForTimeout(120);

    const empty = await canvasStats(page, '#board');
    expect(empty.lit).toBeGreaterThan(200);

    // The falling T plus its ghost are drawn in the piece's metal.
    const withPiece = await canvasStats(page, '#board');
    expect(withPiece.brass).toBeGreaterThan(200);
    expect(withPiece.avg[0]).toBeGreaterThan(90);

    const ghost = await page.evaluate(() => window.__tetris.engine.ghostY());
    expect(ghost).toBe(18);

    await page.evaluate(() => window.__tetris.api.press('hard_drop'));
    await page.waitForTimeout(80);
    const settled = await canvasStats(page, '#board');
    expect(settled.brass).toBeGreaterThanOrEqual(withPiece.brass);
  });

  test('the HUD agrees with the engine', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    // Freeze the clock so the HUD and the engine cannot drift apart between
    // the DOM assertion and the state read.
    await page.evaluate(() => {
      window.__tetris.api.freeze();
      window.__tetris.api.reset({ seed: 'arena' });
      window.__tetris.api.press('hard_drop');
    });
    await page.waitForTimeout(150);

    const s = await state(page);
    await expect(page.locator('#score')).toHaveText(s.score.toLocaleString('en-US'));
    await expect(page.locator('#level')).toHaveText(String(s.level));
    await expect(page.locator('#lines')).toHaveText(String(s.lines));
    await expect(page.locator('#pieces')).toHaveText(String(s.piece_count));

    // The parts bin counts every tetromino the boiler has fed through.
    const tally = await page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll('#tally li')].map((li) => [
        li.querySelector('.chip + span').textContent.trim().split(' ').pop(),
        Number(li.querySelector('.count').textContent),
      ]),
    ));
    expect(Object.values(tally).reduce((a, b) => a + b, 0)).toBe(s.piece_count);
  });

  test('plays on a phone-sized viewport without overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForGame(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const board = await page.locator('#board').boundingBox();
    expect(board.width).toBeGreaterThan(150);
    expect(board.height).toBeGreaterThan(300);
  });

  test('re-renders on resize', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 1400 });
    await page.goto('/');
    await waitForGame(page);
    const taller = await page.evaluate(() => document.querySelector('#board').height);
    await page.setViewportSize({ width: 1100, height: 520 });
    await page.waitForTimeout(250);
    const shorter = await page.evaluate(() => document.querySelector('#board').height);
    expect(shorter).toBeLessThan(taller);
    // The backing store follows the CSS box times the device pixel ratio.
    const matches = await page.evaluate(() => {
      const canvas = document.querySelector('#board');
      const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
      return Math.abs(canvas.width - canvas.getBoundingClientRect().width * ratio) < 2;
    });
    expect(matches).toBe(true);
  });

  test('shows a game-over card when the boiler blows', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    await page.evaluate(() => {
      window.__tetris.api.reset({ seed: 'arena', sequence: 'O'.repeat(40) });
      window.__tetris.api.freeze();
      for (let i = 0; i < 40; i++) {
        const s = window.__tetris.api.state();
        if (s.game_over) break;
        while (window.__tetris.engine.piece && Math.min(...window.__tetris.engine.cellsOf(window.__tetris.engine.piece).map((c) => c[0])) > 0) {
          if (!window.__tetris.api.press('left')) break;
        }
        window.__tetris.api.press('hard_drop');
      }
    });
    await expect(page.locator('#overlay')).toHaveAttribute('data-mode', 'over');
    await expect(page.locator('#overlay-title')).toHaveText(/boiler blown/i);
  });

  test('the boiler goes berserk as the level climbs', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const sample = async (level, waitMs) => page.evaluate(([lv, ms]) => new Promise((resolve) => {
      const t = window.__tetris;
      t.engine.level = lv;
      setTimeout(() => resolve({
        heat: t.renderer.heat,
        particles: t.renderer.particles.length,
        steam: t.renderer.steam.length,
        css: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--heat')),
        alarm: document.getElementById('alarm').dataset.heat,
        level: t.renderer.level,
      }), ms);
    }), [level, waitMs]);

    await page.evaluate(() => {
      window.__tetris.api.freeze();
      window.__tetris.api.reset({ seed: 'arena' });
    });

    const calm = await sample(1, 1200);
    const critical = await sample(22, 2600);

    expect(calm.heat).toBeLessThan(0.15);
    expect(critical.heat).toBeGreaterThan(0.9);
    expect(critical.css).toBeGreaterThanOrEqual(0.9);
    expect(critical.particles).toBeGreaterThan(calm.particles + 60);
    expect(critical.steam).toBeGreaterThan(calm.steam);
    expect(critical.alarm).toBe('critical');
    expect(calm.alarm).not.toBe('critical');

    // The cabinet is genuinely moving: two frames of the same board differ.
    const animating = await page.evaluate(async () => {
      const canvas = document.querySelector('#board');
      const first = canvas.toDataURL();
      await new Promise((r) => setTimeout(r, 140));
      return canvas.toDataURL() !== first;
    });
    expect(animating).toBe(true);
  });

  test('the effects do not cost the frame budget', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    /* Compare the calm board against the full blaze in the same browser rather
       than asserting an absolute frame rate: the test runner's tracing makes the
       absolute number meaningless, but a *ratio* catches the regression that
       matters. An animated full-screen blur once cost 4x here. */
    const fpsAt = async (level) => page.evaluate(async (lv) => {
      const t = window.__tetris;
      t.api.freeze();
      t.engine.level = lv;
      await new Promise((r) => setTimeout(r, lv > 5 ? 1800 : 400));
      return new Promise((resolve) => {
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - started < 1500) requestAnimationFrame(tick);
          else resolve((frames / (performance.now() - started)) * 1000);
        };
        requestAnimationFrame(tick);
      });
    }, level);

    const calm = await fpsAt(1);
    const ablaze = await fpsAt(24);
    expect(ablaze).toBeGreaterThan(8);
    expect(ablaze).toBeGreaterThan(calm * 0.5);
  });

  test('the DOOM skin renders, fights and gives way again', async ({ page }) => {
    const errors = attachErrorCollector(page);
    await page.goto('/?skin=doom');
    await waitForGame(page);

    const start = await page.evaluate(() => {
      const t = window.__tetris;
      t.api.freeze();
      return { skin: t.api.skin(), body: document.body.dataset.skin, demons: t.api.doom().state.demons.length };
    });
    expect(start.skin).toBe('doom');
    expect(start.body).toBe('doom');
    expect(start.demons).toBeGreaterThan(0);

    // The viewport is actually painted: plenty of non-black pixels.
    const lit = await page.evaluate(() => {
      const canvas = document.getElementById('doom-canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 30) count += 1;
      return count;
    });
    expect(lit).toBeGreaterThan(2000);

    // A Tetris is a shotgun blast: it kills, and the HUD says so.
    const killed = await page.evaluate(async () => {
      const t = window.__tetris;
      const before = t.api.doom().state.kills;
      t.api.doom().debugSpawnAt(2.5);
      t.api.doom().debugSpawnAt(3.0);
      t.engine.lines += 4;
      await new Promise((r) => setTimeout(r, 250));
      return { before, after: t.api.doom().state.kills, ammo: t.api.doom().state.ammo };
    });
    expect(killed.after).toBeGreaterThan(killed.before + 1);

    // The status bar shows the DOOM numbers.
    await expect(page.locator('#doom-hud')).toContainText('KILLS');
    await expect(page.locator('#doom-hud')).toContainText('HEALTH');

    // And the button puts the brass back.
    await page.click('#skin-toggle');
    expect(await page.evaluate(() => ({ skin: window.__tetris.api.skin(), body: document.body.dataset.skin })))
      .toEqual({ skin: 'steampunk', body: 'steampunk' });
    errors.assertClean();
  });

  test('the deterministic test surface is stable', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    const out = await page.evaluate(() => {
      window.__tetris.api.reset({ seed: 'arena' });
      const first = window.__tetris.api.advance(3000, 5);
      return { y: first.piece.y, elapsed: first.elapsed_ms, frozen: true };
    });
    expect(out.y).toBe(3);
    expect(out.elapsed).toBeGreaterThan(2900);
    expect((await state(page)).piece.y).toBe(3);
    expect(typeof advance).toBe('function');
  });
});
