/*
 * Bot regression tests.
 *
 * Both bots are run against the real engine on a virtual clock (see
 * bot-harness.mjs), so these are exact, repeatable numbers from a fixed seed
 * set rather than a wobbly real-time observation. Thresholds are set well below
 * the current scores: they are there to catch a regression that breaks the bot,
 * not to freeze a tuned value.
 *
 *   node --test tests/node
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBot, ACTION_INTERVAL_MS } from './bot-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const load = async (name) => (await import(path.join(ROOT, 'bots', 'dist', `${name}.js`))).default;

const STOKER = await load('boiler-stoker');
const FANATIC = await load('four-line-fanatic');

const singleClear = (r) => r.clears[1] + r.clears[2] + r.clears[3];

test('both bundles are up to date with bots/src', () => {
  const out = execFileSync('node', [path.join(ROOT, 'scripts', 'build-bots.mjs'), '--check'], { encoding: 'utf8' });
  assert.match(out, /up to date/);
});

test('both bundles export a single default async function', () => {
  for (const bot of [STOKER, FANATIC]) {
    assert.equal(typeof bot, 'function');
    assert.equal(bot.constructor.name, 'AsyncFunction');
  }
});

test('the score bot plays long, high-scoring games', async () => {
  for (const seed of ['arena', 'deepseek', 'calvin']) {
    const r = await runBot(STOKER, { seed });
    assert.equal(r.error, null, `${seed} threw: ${r.error}`);
    assert.equal(r.stalled, false, `${seed} never reached a game over`);
    assert.equal(r.gameOver, true, `${seed} did not top out`);
    assert.ok(r.score > 100_000, `${seed} scored only ${r.score}`);
    assert.ok(r.level >= 10, `${seed} only reached level ${r.level}`);
    assert.ok(r.pieces > 300, `${seed} only placed ${r.pieces} pieces`);
    assert.ok(r.meanActionsPerPiece <= 6, `${seed} used ${r.meanActionsPerPiece.toFixed(1)} actions per piece`);
    assert.ok(r.maxActionsPerPiece <= 22, `${seed} used ${r.maxActionsPerPiece} actions on one piece`);
    assert.ok(r.actions * ACTION_INTERVAL_MS <= r.virtualMs + 5, `${seed} exceeded the 30 actions/second budget`);
  }
});

test('the hunter bot only ever clears four rows at once on clean seeds', async () => {
  for (const seed of ['arena', 'fanatic']) {
    const r = await runBot(FANATIC, { seed });
    assert.equal(r.error, null, `${seed} threw: ${r.error}`);
    assert.equal(r.gameOver, true, `${seed} did not top out`);
    assert.equal(singleClear(r), 0, `${seed} made ${singleClear(r)} non-Tetris clears`);
    assert.ok(r.tetrises >= 8, `${seed} only made ${r.tetrises} Tetrises`);
    assert.equal(r.lines, r.tetrises * 4, `${seed} lines must all come from Tetrises`);
  }
});

test('the hunter bot survives and scores on the reference seed', async () => {
  const r = await runBot(FANATIC, { seed: 'arena' });
  assert.ok(r.score > 100_000, `scored only ${r.score}`);
  assert.ok(r.level >= 10, `reached only level ${r.level}`);
  assert.ok(r.pieces > 300, `placed only ${r.pieces} pieces`);
});

test('the hunter bot digs out instead of dying when a Tetris becomes impossible', async () => {
  // "brass" is a seed where the bot has to make ordinary clears to reopen the well.
  const r = await runBot(FANATIC, { seed: 'brass' });
  assert.equal(r.error, null);
  assert.equal(r.gameOver, true);
  assert.ok(r.pieces > 100, `gave up after ${r.pieces} pieces`);
});

test('both bots stay inside the action budget and never get stuck on a piece', async () => {
  for (const [name, bot] of [['stoker', STOKER], ['fanatic', FANATIC]]) {
    const r = await runBot(bot, { seed: 'boiler' });
    assert.equal(r.error, null, `${name} threw: ${r.error}`);
    assert.ok(r.meanActionsPerPiece <= 6, `${name} averaged ${r.meanActionsPerPiece.toFixed(1)} actions per piece`);
    assert.ok(r.maxActionsPerPiece <= 22, `${name} used ${r.maxActionsPerPiece} actions on one piece`);
    assert.ok(r.illegal <= r.pieces, `${name} sent ${r.illegal} illegal actions`);
  }
});

test('bots are deterministic for a given seed', async () => {
  const a = await runBot(STOKER, { seed: 'arena' });
  const b = await runBot(STOKER, { seed: 'arena' });
  assert.deepEqual(
    { score: a.score, lines: a.lines, pieces: a.pieces },
    { score: b.score, lines: b.lines, pieces: b.pieces },
  );
});

test('bots cope with a game that ignores illegal input', async () => {
  const r = await runBot(FANATIC, { seed: 'valve' });
  assert.equal(r.error, null, `threw: ${r.error}`);
  assert.equal(r.gameOver, true);
});
