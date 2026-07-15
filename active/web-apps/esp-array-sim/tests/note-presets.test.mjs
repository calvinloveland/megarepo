import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_PRESETS, getNotePreset, applyNotePreset } from '../src/note-presets.mjs';

test('note presets have unique ids', () => {
  const ids = NOTE_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('getNotePreset resolves known ids and unknown returns null', () => {
  assert.equal(getNotePreset('hard-reverb')?.label, 'hard living-room reverb');
  assert.equal(getNotePreset('missing'), null);
});

test('applyNotePreset fills empty notes and appends without duplication', () => {
  assert.equal(applyNotePreset('', 'high-noise'), 'high-noise scan');
  assert.equal(applyNotePreset('baseline', 'high-noise'), 'baseline · high-noise scan');
  assert.equal(applyNotePreset('baseline · high-noise scan', 'high-noise'), 'baseline · high-noise scan');
});