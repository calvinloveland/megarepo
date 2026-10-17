/*
 * In-process bot harness.
 *
 * The engine has no DOM dependency, so a bot can be driven directly against it
 * on a virtual clock. That makes bot runs deterministic and instant instead of
 * spending a real 60 seconds per seed, and it still models the two constraints
 * the Arena imposes: the 30 actions/second rate limit (§8) and gravity running
 * off elapsed time (§4).
 *
 *   node scripts/run-bot.mjs                       # print a scoreboard
 */

import { TetrisEngine } from '../../src/engine.js';

export const ACTION_INTERVAL_MS = 1000 / 30;

/**
 * @param {(game: object, info: object) => Promise<void>} botFn default export of a bot module
 * @param {{seed?: string, sequence?: string|null, maxVirtualMs?: number, maxActions?: number}} opts
 */
export async function runBot(botFn, opts = {}) {
  const {
    seed = 'arena', sequence = null, maxVirtualMs = 15 * 60 * 1000, maxActions = 20000,
    actionIntervalMs = ACTION_INTERVAL_MS,
  } = opts;

  const engine = new TetrisEngine({ seed, sequence });
  let clock = 0;
  engine.tick(clock);

  let actions = 0;
  let illegal = 0;
  let sleeps = 0;
  let virtualMs = 0;
  let stalled = false;
  const actionsPerPiece = [];
  let pieceStartActions = 0;
  let trackedPiece = engine.pieceCount;

  const game = {
    done: false,
    state: () => engine.toState(),
    sleep: async (ms) => {
      sleeps += 1;
      virtualMs += ms;
      clock += ms;
      engine.tick(clock);
      if (clock > maxVirtualMs) game.done = true;
    },
    input: async (action) => {
      // The Arena delays anything over 30 actions/second; model that rather
      // than letting the bot pretend it can act instantly. Raising
      // actionIntervalMs lowers the effective rate — used to measure how much
      // of a bot's limit is the clock rather than the strategy.
      clock += actionIntervalMs;
      virtualMs += actionIntervalMs;
      engine.tick(clock);
      const legal = engine.applyAction(action);
      actions += 1;
      if (!legal) illegal += 1;
      if (engine.pieceCount !== trackedPiece) {
        actionsPerPiece.push(actions - pieceStartActions);
        pieceStartActions = actions;
        trackedPiece = engine.pieceCount;
      }
      if (clock > maxVirtualMs || actions > maxActions) game.done = true;
      return { legal, state: engine.toState() };
    },
  };

  const startedAt = Date.now();
  const info = { seed, gameName: 'Brass & Boiler', deadlineMs: maxVirtualMs };
  let error = null;
  try {
    await botFn(game, info);
  } catch (err) {
    error = String((err && err.stack) || err);
  }
  if (!engine.gameOver && !game.done) stalled = true;

  const state = engine.toState();
  const lastActions = actionsPerPiece.slice(-25);
  return {
    seed,
    error,
    stalled,
    board: state.board,
    tailActionsPerPiece: lastActions,
    tailMeanActions: lastActions.length
      ? lastActions.reduce((a, b) => a + b, 0) / lastActions.length
      : 0,
    gameOver: engine.gameOver,
    score: state.score,
    lines: state.lines,
    level: state.level,
    tetrises: engine.tetrises,
    perfectClears: engine.perfectClears,
    clears: { ...engine.lineClears },
    pieces: state.piece_count,
    actions,
    illegal,
    sleeps,
    virtualMs: Math.round(virtualMs),
    wallMs: Date.now() - startedAt,
    actionsPerPiece,
    meanActionsPerPiece: actionsPerPiece.length
      ? actionsPerPiece.reduce((a, b) => a + b, 0) / actionsPerPiece.length
      : 0,
    maxActionsPerPiece: actionsPerPiece.length ? Math.max(...actionsPerPiece) : 0,
  };
}
