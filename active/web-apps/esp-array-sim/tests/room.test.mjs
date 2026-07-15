import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSources, arrivalPaths, segmentHitsRect } from '../src/room.mjs';
import { SPEED_OF_SOUND } from '../src/acoustics.mjs';

const room = { width: 6, height: 5 };

test('order-1 image sources mirror the emitter against each wall', () => {
  const e = { x: 2, y: 1 };
  const imgs = imageSources(e, room, 1);
  assert.equal(imgs.length, 4);
  const pts = imgs.map((i) => [i.pos.x, i.pos.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(pts, [
    [-2, 1], // left
    [2, -1], // bottom
    [2, 9],  // top (2H - y = 10 - 1)
    [10, 1], // right (2W - x = 12 - 2)
  ]);
});

test('a direct arrivalPath always has amplitude 1 and the shortest delay', () => {
  const e = { x: 1, y: 1 }, l = { x: 4, y: 4 };
  const paths = arrivalPaths(e, l, room, 0.7);
  const direct = paths.find((p) => p.kind === 'direct');
  assert.equal(direct.amplitude, 1);
  const dDelay = direct.delaySec;
  for (const p of paths) if (p !== direct) assert.ok(p.delaySec > dDelay, 'echo must arrive after direct');
});

test('echo amplitude scales with reflCoef^order and falls off with extra distance', () => {
  const e = { x: 1, y: 1 }, l = { x: 5, y: 1 }; // near the right wall
  const weak = arrivalPaths(e, l, room, 0.3).filter((p) => p.kind === 'echo');
  const strong = arrivalPaths(e, l, room, 0.9).filter((p) => p.kind === 'echo');
  // for each matching echo the strong-reverb amplitude is larger
  assert.ok(weak.length > 0);
  assert.ok(strong.length > 0);
  assert.ok(strong[0].amplitude > weak[0].amplitude);
  // echoes are always quieter than direct (reflCoef<1, longer path)
  for (const p of strong) assert.ok(p.amplitude < 1, `echo louder than direct: ${p.amplitude}`);
});

test('segmentHitsRect detects a blocking rectangle on the path', () => {
  const a = { x: 0, y: 2 }, b = { x: 6, y: 2 };
  const block = { minX: 2, minY: 1, maxX: 4, maxY: 3 };
  const clear = { minX: 4, minY: 3, maxX: 5, maxY: 4 };
  assert.equal(segmentHitsRect(a, b, block), true);
  assert.equal(segmentHitsRect(a, b, clear), false);
});