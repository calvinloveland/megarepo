import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEED_OF_SOUND,
  propagationDelay,
  distance,
  freeFieldGain,
  timeToDistance,
} from '../src/acoustics.mjs';

test('speed of sound is the canonical 343 m/s constant', () => {
  assert.equal(SPEED_OF_SOUND, 343);
});

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

test('propagationDelay(d) = d / c', () => {
  assert.equal(propagationDelay(343), 1);
  approx(propagationDelay(3.43), 0.01);
});

test('distance is planar euclidean', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('freeFieldGain falls off as 1/d from 1m', () => {
  assert.equal(freeFieldGain(1), 1);
  approx(freeFieldGain(2), 0.5);
  assert.equal(freeFieldGain(0), 1);
});

test('timeToDistance is the inverse of propagationDelay', () => {
  approx(timeToDistance(propagationDelay(2.5)), 2.5);
});