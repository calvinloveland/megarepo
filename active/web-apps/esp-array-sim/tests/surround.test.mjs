import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS_5_1,
  azimuthToVec,
  vecToAzimuthDeg,
  angleDeltaDeg,
  speakerGeometry,
  mapSurround,
  speakerCompensation,
} from '../src/surround.mjs';

test('5.1 channels are the six canonical ITU slots', () => {
  const ids = CHANNELS_5_1.map((c) => c.id).sort();
  assert.deepEqual(ids, ['C', 'L', 'LFE', 'Ls', 'R', 'Rs']);
});

test('azimuthToVec / vecToAzimuth are consistent', () => {
  for (const deg of [0, 30, -30, 110, -110, 90, -90, 180]) {
    const v = azimuthToVec(deg);
    const back = vecToAzimuthDeg(v);
    // directions differing by ±180° describe the same axis; use signed delta.
    assert.equal(angleDeltaDeg(back, deg), 0, `round-trip failed for ${deg}° -> ${back}°`);
  }
});

test('angleDeltaDeg wraps to (-180, 180]', () => {
  // smallest signed difference a-b
  assert.equal(angleDeltaDeg(10, 350), 20);   // 10 - 350 = -340 -> +20
  assert.equal(angleDeltaDeg(350, 10), -20);  // 350 - 10 = 340 -> -20
  assert.equal(angleDeltaDeg(0, 30), -30);
  assert.equal(angleDeltaDeg(30, 0), 30);
  assert.equal(angleDeltaDeg(0, 180), 180); // boundary lands at +180
});

test('a channel lined up with a single real speaker routes ~all gain there', () => {
  const sweet = { x: 0, y: 0 };
  const spk = [{ id: 'N0', pos: { x: 1, y: 0 } }]; // directly in front -> azimuth 0
  const m = mapSurround(spk, sweet, { distanceLaw: 0 });
  const center = m.find((c) => c.channel === 'C');
  const top = center.mapping[0];
  assert.ok(top.gain > 0.999, `expected gain≈1 on aligned speaker, got ${top.gain}`);
  assert.equal(top.id, 'N0');
});

test('two speakers bracketing a virtual channel split its gain', () => {
  const sweet = { x: 0, y: 0 };
  // one at +30°, one at -30°: a centre virtual channel (0°) should be near-50/50
  const spk = [
    { id: 'R', pos: { x: Math.cos(30 * Math.PI / 180), y: Math.sin(30 * Math.PI / 180) } },
    { id: 'L', pos: { x: Math.cos(-30 * Math.PI / 180), y: Math.sin(-30 * Math.PI / 180) } },
  ];
  const m = mapSurround(spk, sweet, { distanceLaw: 0, exponent: 1 });
  const center = m.find((c) => c.channel === 'C');
  const near = center.mapping.filter((x) => x.gain > 0.4);
  assert.equal(near.length, 2, 'centre should be split across both speakers');
});

test('mapSurround always returns 6 channels', () => {
  const spk = [
    { id: 'N0', pos: { x: 1, y: 0 } },
    { id: 'N1', pos: { x: -1, y: 0 } },
    { id: 'N2', pos: { x: 0, y: 1 } },
  ];
  const m = mapSurround(spk, { x: 0, y: 0 });
  assert.equal(m.length, 6);
  for (const c of m) assert.ok(c.mapping.length > 0);
});

test('speakerCompensation delays nearer speakers and equalizes loudness to the furthest', () => {
  const sweet = { x: 0, y: 0 };
  const spk = [
    { id: 'near', pos: { x: 1, y: 0 } },   // 1 m away
    { id: 'far', pos: { x: 4, y: 0 } },    // 4 m away (furthest)
  ];
  const comp = speakerCompensation(spk, sweet);
  const near = comp.find((c) => c.id === 'near');
  const far = comp.find((c) => c.id === 'far');
  // furthest gets zero added delay & unity gain; nearer is delayed and attenuated
  assert.equal(far.delaySec, 0);
  assert.equal(far.gainLinear, 1);
  assert.ok(near.delaySec > 0, 'nearer speaker should be delayed');
  assert.ok(near.gainLinear < 1 && near.gainLinear > 0, 'nearer speaker attenuated');
  assert.ok(Math.abs(near.delaySec - (4 - 1) / 343) < 1e-9, 'nearer delay = (maxDist-d)/c');
});

test('speakerCompensation arrives simultaneously at the sweet spot', () => {
  const sweet = { x: 2, y: 2 };
  const spk = [
    { id: 'A', pos: { x: 0, y: 0 } },
    { id: 'B', pos: { x: 5, y: 0 } },
    { id: 'C', pos: { x: 3, y: 5 } },
  ];
  const comp = speakerCompensation(spk, sweet);
  // (play time + added delay + propagation) should be equal for all speakers
  const arrivals = comp.map((c) => c.delaySec + c.distanceM / 343);
  const spread = Math.max(...arrivals) - Math.min(...arrivals);
  assert.ok(spread < 1e-9, `compensated arrivals not aligned: spread ${spread.toExponential(2)}`);
});