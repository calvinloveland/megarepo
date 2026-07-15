import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSurround, speakerCompensation, CHANNELS_5_1 } from '../src/surround.mjs';
import { channelSeparation } from '../src/render.mjs';

// Build a controlled scenario object (exactly the fields channelSeparation reads)
// so we can place speakers deterministically at the 5.1 azimuths.
function buildScenario(speakers, sweetSpot) {
  return buildScenarioSharp(speakers, sweetSpot, 4);
}
function buildScenarioSharp(speakers, sweetSpot, exponent) {
  const surround = mapSurround(speakers, sweetSpot, { distanceLaw: 0, exponent });
  const compensation = speakerCompensation(speakers, sweetSpot);
  return { surround, compensation, realSpeakers: speakers, sweetSpot };
}

function speakersAtAzimuths(azDegs, radius = 3, sweetSpot = { x: 4, y: 3 }) {
  return azDegs.map((deg, i) => {
    const r = (deg * Math.PI) / 180;
    return { id: `N${i}`, pos: { x: sweetSpot.x + radius * Math.cos(r), y: sweetSpot.y + radius * Math.sin(r) } };
  });
}

test('when one speaker sits exactly at a channel\'s azimuth, separation error ≈ 0', () => {
  // a single front speaker at 0° reproduces the centre channel perfectly on-axis
  const speakers = speakersAtAzimuths([0]);
  const s = buildScenario(speakers, { x: 4, y: 3 });
  const c = channelSeparation(s, 'C');
  assert.ok(c.errorDeg < 1, `C err ${c.errorDeg.toFixed(2)} expected ~0`);
  // L at -30° with one speaker at -30°
  const speakersL = speakersAtAzimuths([-30]);
  const sl = buildScenario(speakersL, { x: 4, y: 3 });
  const l = channelSeparation(sl, 'L');
  assert.ok(l.errorDeg < 1, `L err ${l.errorDeg.toFixed(2)} expected ~0`);
});

test('a full ITU speaker ring reproduces all five directional channels once the panner is sharp', () => {
  // The cosine-power panner at exponent 4 deliberately bleeds to neighbouring
  // speakers (soft panning); sharpening it concentrates each channel on its
  // speaker. With exponent 16 and a speaker at each ITU azimuth, all five
  // directional channels reproduce within a few degrees.
  const azs = CHANNELS_5_1.filter((c) => !c.lfe).map((c) => c.azimuthDeg);
  const speakers = speakersAtAzimuths(azs, 3, { x: 5, y: 3 });
  const s = buildScenarioSharp(speakers, { x: 5, y: 3 }, 16);
  for (const ch of ['L', 'R', 'C', 'Ls', 'Rs']) {
    const r = channelSeparation(s, ch);
    assert.ok(r.errorDeg < 5, `${ch} reproduces its azimuth within 5° (got ${r.errorDeg.toFixed(1)}°)`);
  }
});

test('sharper panning reduces channel-separation error (the bleed trade-off)', () => {
  const azs = CHANNELS_5_1.filter((c) => !c.lfe).map((c) => c.azimuthDeg);
  const speakers = speakersAtAzimuths(azs, 3, { x: 5, y: 3 });
  const soft = buildScenarioSharp(speakers, { x: 5, y: 3 }, 2);
  const sharp = buildScenarioSharp(speakers, { x: 5, y: 3 }, 16);
  const softErr = ['L', 'R', 'C', 'Ls', 'Rs'].map((ch) => channelSeparation(soft, ch).errorDeg).reduce((a, b) => a + b);
  const sharpErr = ['L', 'R', 'C', 'Ls', 'Rs'].map((ch) => channelSeparation(sharp, ch).errorDeg).reduce((a, b) => a + b);
  assert.ok(sharpErr < softErr,
    `sharp panner (exp 16, ${sharpErr.toFixed(1)}°) should separate better than soft (exp 2, ${softErr.toFixed(1)}°)`);
});

test('directional polarity holds: L observes left, R observes right, even with mismatched layouts', () => {
  // speakers only to the front-left and front-right; L must observe ≤0°, R ≥0°.
  const speakers = speakersAtAzimuths([-40, 40], 3, { x: 5, y: 3 });
  const s = buildScenario(speakers, { x: 5, y: 3 });
  const l = channelSeparation(s, 'L');
  const r = channelSeparation(s, 'R');
  assert.ok(l.observedAzDeg <= 0, `L should observe left (≤0°), got ${l.observedAzDeg.toFixed(1)}°`);
  assert.ok(r.observedAzDeg >= 0, `R should observe right (≥0°), got ${r.observedAzDeg.toFixed(1)}°`);
});

test('LFE separation is non-directional (uses the omnidirectional nearest routing)', () => {
  const speakers = speakersAtAzimuths([-30, 30], 3, { x: 5, y: 3 });
  const s = buildScenario(speakers, { x: 5, y: 3 });
  const lfe = channelSeparation(s, 'LFE');
  // LFE intended azimuth is 0; nearestrouting sends it to the two front speakers,
  // so the observed centroid lies between them (near 0°).
  assert.ok(lfe.errorDeg < 30, `LFE centroid should stay front-ish, got err ${lfe.errorDeg.toFixed(1)}°`);
});