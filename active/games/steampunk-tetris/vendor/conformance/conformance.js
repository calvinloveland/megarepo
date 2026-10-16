/*
 * Tetris Protocol v2 conformance suite.
 *
 * Shared by tests/conformance.html (what participants run) and the Arena's upload
 * validator (what decides whether a submission is accepted). Same checks in both,
 * deliberately — a game that passes locally must pass at the table.
 */

export const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
export const EXPECTED_ARENA_SEED = ['T', 'L', 'O', 'J', 'I', 'S', 'Z', 'O', 'S', 'Z', 'L', 'I', 'J', 'T'];
export const GRAVITY_MS = [1000, 793, 618, 473, 355, 262, 190, 135, 94, 64, 43, 28, 20];

const PROTO = 'tetris/2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- client -- */

export function createClient(iframe) {
  let nextId = 1;
  const pending = new Map();
  let readyMsg = null;
  const readyWaiters = [];
  let lastUpdate = null;

  function onMessage(event) {
    const win = iframe.contentWindow;
    if (!win || event.source !== win) return;
    const msg = event.data;
    if (!msg || msg.proto !== PROTO) return;

    if (msg.type === 'ready') {
      readyMsg = msg.payload || {};
      readyWaiters.splice(0).forEach((fn) => fn(readyMsg));
      return;
    }
    if (msg.type === 'update') {
      lastUpdate = msg.payload;
      return;
    }
    if (msg.type === 'result') {
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      clearTimeout(slot.timer);
      if (msg.ok === false) slot.reject(new Error((msg.payload && msg.payload.error) || 'game reported failure'));
      else slot.resolve(msg.payload);
    }
  }

  window.addEventListener('message', onMessage);

  function request(type, payload, timeoutMs = 2000) {
    const win = iframe.contentWindow;
    if (!win) return Promise.reject(new Error('game frame is not loaded'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no reply to "${type}" within ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      win.postMessage({ proto: PROTO, id, type, payload: payload || {} }, '*');
    });
  }

  return {
    request,
    get lastUpdate() { return lastUpdate; },
    get ready() { return readyMsg; },
    waitForReady(timeoutMs = 10000) {
      if (readyMsg) return Promise.resolve(readyMsg);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no "ready" message within ${timeoutMs}ms`)), timeoutMs);
        readyWaiters.push((m) => { clearTimeout(timer); resolve(m); });
      });
    },
    newGame: (opts) => request('new', opts || { seed: 'arena' }, 4000),
    state: () => request('state'),
    input: (action) => request('input', { action }),
    pause: (paused) => request('pause', { paused }),
    destroy() { window.removeEventListener('message', onMessage); },
  };
}

/* ------------------------------------------------------------ assertions -- */

function fail(msg) { throw new Error(msg); }
function assert(cond, msg) { if (!cond) fail(msg); }

export function checkStateShape(s, where = 'state') {
  assert(s && typeof s === 'object', `${where}: not an object`);
  assert(Array.isArray(s.board), `${where}.board: must be an array`);
  assert(s.board.length === 20, `${where}.board: expected 20 rows, got ${s.board.length}`);
  s.board.forEach((row, i) => {
    assert(typeof row === 'string', `${where}.board[${i}]: must be a string`);
    assert(row.length === 10, `${where}.board[${i}]: expected 10 columns, got ${row.length}`);
    assert(/^[.IOTSZJL]+$/.test(row), `${where}.board[${i}]: illegal characters in "${row}"`);
  });
  assert(Array.isArray(s.next), `${where}.next: must be an array`);
  assert(s.next.length === 5, `${where}.next: expected exactly 5 pieces, got ${s.next.length}`);
  s.next.forEach((p, i) => assert(PIECES.includes(p), `${where}.next[${i}]: "${p}" is not a piece letter`));
  assert(s.hold === null || PIECES.includes(s.hold), `${where}.hold: must be null or a piece letter`);
  assert(typeof s.can_hold === 'boolean', `${where}.can_hold: must be a boolean`);
  ['score', 'lines', 'level', 'elapsed_ms', 'gravity_ms', 'piece_count'].forEach((k) => {
    assert(typeof s[k] === 'number' && isFinite(s[k]), `${where}.${k}: must be a number, got ${JSON.stringify(s[k])}`);
  });
  assert(typeof s.game_over === 'boolean', `${where}.game_over: must be a boolean`);
  assert(s.lock_timer_ms === null || typeof s.lock_timer_ms === 'number',
    `${where}.lock_timer_ms: must be a number or null`);

  if (s.game_over) {
    assert(s.piece === null, `${where}.piece: must be null when game_over is true`);
  } else {
    assert(s.piece && typeof s.piece === 'object', `${where}.piece: must be an object while playing`);
    assert(PIECES.includes(s.piece.type), `${where}.piece.type: "${s.piece.type}" is not a piece letter`);
    ['x', 'y', 'rotation'].forEach((k) =>
      assert(typeof s.piece[k] === 'number', `${where}.piece.${k}: must be a number`));
    assert(s.piece.rotation >= 0 && s.piece.rotation <= 3, `${where}.piece.rotation: must be 0-3`);
    assert(Array.isArray(s.piece.cells) && s.piece.cells.length === 4,
      `${where}.piece.cells: expected 4 cells, got ${s.piece.cells && s.piece.cells.length}`);
    s.piece.cells.forEach((c, i) => {
      assert(Array.isArray(c) && c.length === 2, `${where}.piece.cells[${i}]: expected [col, row]`);
      assert(c[0] >= 0 && c[0] < 10, `${where}.piece.cells[${i}]: column ${c[0]} is off the board`);
      assert(c[1] >= 0 && c[1] < 20, `${where}.piece.cells[${i}]: row ${c[1]} is off the board`);
      assert(s.board[c[1]][c[0]] === '.',
        `${where}: the falling piece at [${c}] is drawn into board — it must be reported only in piece.cells`);
    });
  }
}

const filled = (s) => s.board.join('').split('').filter((c) => c !== '.').length;

/* ----------------------------------------------------------------- tests -- */

const TESTS = [
  {
    name: 'ready handshake',
    detail: 'the game announces itself within 10 seconds',
    async run(c) {
      const ready = await c.waitForReady(10000);
      assert(ready && typeof ready === 'object', 'ready payload must be an object');
      if (!ready.name) return 'loaded, but sent no name in the ready payload';
      return `loaded as "${ready.name}"`;
    },
  },
  {
    name: 'new game state',
    detail: 'POST new returns a well-formed state',
    async run(c) {
      const s = await c.newGame({ seed: 'arena' });
      checkStateShape(s, 'new');
      assert(s.game_over === false, 'a new game must not start game_over');
      assert(s.score === 0 && s.lines === 0, 'a new game must start at score 0, lines 0');
      assert(s.level === 1, `a new game must start at level 1, got ${s.level}`);
      assert(filled(s) === 0, 'a new game must start with an empty board');
      return 'clean start';
    },
  },
  {
    name: 'seeded 7-bag',
    detail: 'seed "arena" produces the exact documented sequence',
    async run(c) {
      const s = await c.newGame({ seed: 'arena' });
      const got = [s.piece.type, ...s.next];
      const want = EXPECTED_ARENA_SEED.slice(0, 6);
      assert(got.join(' ') === want.join(' '),
        `expected ${want.join(' ')} but got ${got.join(' ')} — check the PRNG in PROTOCOL.md §3`);
      return got.join(' ');
    },
  },
  {
    name: 'bag refill',
    detail: 'the second bag follows the first correctly',
    async run(c) {
      await c.newGame({ seed: 'arena' });
      const seen = [];
      for (let i = 0; i < 5; i++) {
        const { state } = await c.input('hard_drop');
        if (state.game_over) break;
        seen.push(state.piece.type);
      }
      const want = EXPECTED_ARENA_SEED.slice(1, 1 + seen.length);
      assert(seen.join(' ') === want.join(' '),
        `after ${seen.length} drops expected ${want.join(' ')} but got ${seen.join(' ')}`);
      return seen.join(' ');
    },
  },
  {
    name: 'spawn position',
    detail: 'pieces spawn at x=3, y=0, rotation=0',
    async run(c) {
      const s = await c.newGame({ seed: 'arena' });
      assert(s.piece.x === 3, `expected piece.x === 3, got ${s.piece.x}`);
      assert(s.piece.y === 0, `expected piece.y === 0, got ${s.piece.y}`);
      assert(s.piece.rotation === 0, `expected rotation 0, got ${s.piece.rotation}`);
      return 'x=3 y=0 r=0';
    },
  },
  {
    name: 'movement',
    detail: 'left and right move exactly one column',
    async run(c) {
      const s0 = await c.newGame({ seed: 'arena' });
      const { legal, state } = await c.input('left');
      assert(legal === true, 'moving left from spawn should be legal');
      assert(state.piece.x === s0.piece.x - 1, `left should decrease x by 1 (${s0.piece.x} -> ${state.piece.x})`);
      const back = await c.input('right');
      assert(back.legal === true, 'moving back right should be legal');
      assert(back.state.piece.x === s0.piece.x, 'right should undo left');
      return 'one column per action';
    },
  },
  {
    name: 'illegal moves are not errors',
    detail: 'walking into the wall reports legal:false and changes nothing',
    async run(c) {
      await c.newGame({ seed: 'arena' });
      let last = null;
      for (let i = 0; i < 12; i++) {
        const res = await c.input('left');
        if (!res.legal) { last = res; break; }
      }
      assert(last, 'moving left 12 times never became illegal — the piece left the board');
      const before = JSON.stringify(last.state.piece);
      const again = await c.input('left');
      assert(again.legal === false, 'a blocked move must stay illegal');
      assert(JSON.stringify(again.state.piece) === before, 'an illegal move must leave the state unchanged');
      return 'blocked at the wall';
    },
  },
  {
    name: 'rotation',
    detail: 'rotate_cw advances rotation and keeps 4 cells',
    async run(c) {
      const s = await c.newGame({ seed: 'arena' }); // T piece
      const r = await c.input('rotate_cw');
      assert(r.legal === true, 'rotating a T at spawn should be legal');
      assert(r.state.piece.rotation === (s.piece.rotation + 1) % 4,
        `rotate_cw should advance rotation 0 -> 1, got ${r.state.piece.rotation}`);
      assert(r.state.piece.cells.length === 4, 'a rotated piece still has 4 cells');
      const back = await c.input('rotate_ccw');
      assert(back.state.piece.rotation === 0, 'rotate_ccw should return to rotation 0');
      return 'SRS rotation responds';
    },
  },
  {
    name: 'hard drop locks',
    detail: 'hard_drop locks the piece and spawns the next one',
    async run(c) {
      const s0 = await c.newGame({ seed: 'arena' });
      const { state } = await c.input('hard_drop');
      assert(filled(state) === 4, `after one hard drop the board should hold 4 cells, found ${filled(state)}`);
      assert(state.piece_count === s0.piece_count + 1,
        `piece_count should advance (${s0.piece_count} -> ${state.piece_count})`);
      assert(state.piece.type === s0.next[0],
        `the new piece should be next[0] (${s0.next[0]}), got ${state.piece.type}`);
      assert(state.score >= 2, `hard_drop must award 2 points per row dropped, score is ${state.score}`);
      return `locked, score ${state.score}`;
    },
  },
  {
    name: 'hold',
    detail: 'hold swaps once per piece',
    async run(c) {
      const s0 = await c.newGame({ seed: 'arena' });
      assert(s0.can_hold === true, 'can_hold must start true');
      const h = await c.input('hold');
      assert(h.legal === true, 'the first hold must be legal');
      assert(h.state.hold === s0.piece.type, `hold should now contain ${s0.piece.type}, got ${h.state.hold}`);
      assert(h.state.piece.type === s0.next[0],
        `after holding an empty slot the next piece should come in (${s0.next[0]}), got ${h.state.piece.type}`);
      assert(h.state.can_hold === false, 'can_hold must be false until the next piece locks');
      const twice = await c.input('hold');
      assert(twice.legal === false, 'a second hold on the same piece must be illegal');
      return 'swaps once, then blocks';
    },
  },
  {
    name: 'gravity runs without input',
    detail: 'the piece falls on its own at roughly one row per second on level 1',
    async run(c) {
      const s0 = await c.newGame({ seed: 'arena' });
      assert(s0.gravity_ms === 1000, `level 1 gravity must be 1000ms, got ${s0.gravity_ms}`);
      const y0 = s0.piece.y;
      await sleep(3200);
      const s1 = await c.state();
      if (s1.game_over || s1.piece_count !== s0.piece_count) return 'piece fell and locked (fast, but falling)';
      const fell = s1.piece.y - y0;
      assert(fell > 0, 'the piece did not move in 3.2 seconds — gravity is not running');
      assert(fell >= 2 && fell <= 5,
        `expected roughly 3 rows in 3.2s at level 1, got ${fell} — gravity is probably frame-based, not clock-based`);
      assert(s1.elapsed_ms >= 2500, `elapsed_ms should track real time, got ${s1.elapsed_ms}`);
      return `${fell} rows in 3.2s`;
    },
  },
  {
    name: 'lock delay',
    detail: 'a resting piece reports a lock timer and locks by itself',
    async run(c) {
      const s0 = await c.newGame({ seed: 'arena' });
      for (let i = 0; i < 25; i++) {
        const r = await c.input('soft_drop');
        if (!r.legal) break;
      }
      const resting = await c.state();
      assert(resting.piece_count === s0.piece_count, 'soft_drop must not lock the piece');
      assert(typeof resting.lock_timer_ms === 'number',
        'a resting piece must report lock_timer_ms as a number, got ' + JSON.stringify(resting.lock_timer_ms));
      await sleep(900);
      const after = await c.state();
      assert(after.piece_count === s0.piece_count + 1,
        'the resting piece should have locked by itself within 900ms (lock delay is 500ms at level 1)');
      return 'locks after the delay';
    },
  },
  {
    name: 'lock delay reset cap',
    detail: 'spamming moves cannot keep a piece alive forever',
    async run(c) {
      await c.newGame({ seed: 'arena' });
      for (let i = 0; i < 25; i++) {
        const r = await c.input('soft_drop');
        if (!r.legal) break;
      }
      const before = (await c.state()).piece_count;
      // 24 alternating moves: well past the 15-reset cap.
      for (let i = 0; i < 24; i++) {
        await c.input(i % 2 ? 'left' : 'right');
        await sleep(40);
      }
      await sleep(700);
      const after = await c.state();
      assert(after.piece_count > before || after.game_over,
        'the piece never locked while being nudged — cap lock-delay resets at 15 or games never end');
      return 'capped at 15 resets';
    },
  },
  {
    name: 'line clear and scoring',
    detail: 'five O pieces clear two rows and score 300',
    async run(c) {
      await c.newGame({ seed: 'arena', sequence: 'OOOOO' });
      const s = await c.state();
      assert(s.piece.type === 'O', `the sequence option is not honoured — expected an O, got ${s.piece.type}`);
      // O spawns occupying columns 4-5. Walk each one to its column and drop.
      for (const target of [0, 2, 4, 6, 8]) {
        let guard = 0;
        while (guard++ < 12) {
          const cur = await c.state();
          if (cur.game_over) break;
          const left = Math.min(...cur.piece.cells.map((p) => p[0]));
          if (left === target) break;
          const res = await c.input(left > target ? 'left' : 'right');
          if (!res.legal) break;
        }
        await c.input('hard_drop');
      }
      const end = await c.state();
      assert(end.lines === 2, `five O pieces across the floor must clear exactly 2 lines, got ${end.lines}`);
      assert(filled(end) === 0, `both rows should be gone, but ${filled(end)} cells remain`);
      assert(end.score >= 300, `a double is worth 300 at level 1, score is only ${end.score}`);
      assert(end.level === 1, `level is 1 + floor(lines/10) = 1 at 2 lines, got ${end.level}`);
      return `2 lines, score ${end.score}`;
    },
  },
  {
    name: 'pause stops the clock',
    detail: 'a paused game does not advance',
    async run(c) {
      await c.newGame({ seed: 'arena' });
      await c.pause(true);
      const a = await c.state();
      await sleep(900);
      const b = await c.state();
      assert(Math.abs(b.elapsed_ms - a.elapsed_ms) < 250,
        `elapsed_ms moved by ${b.elapsed_ms - a.elapsed_ms}ms while paused — the clock must stop`);
      assert(b.piece.y === a.piece.y, 'the piece fell while the game was paused');
      await c.pause(false);
      await sleep(600);
      const d = await c.state();
      assert(d.elapsed_ms > b.elapsed_ms, 'the clock did not restart after unpausing');
      return 'stops and restarts';
    },
  },
  {
    name: 'game over',
    detail: 'stacking to the ceiling ends the game cleanly',
    async run(c) {
      await c.newGame({ seed: 'arena', sequence: 'O'.repeat(30) });
      let state = await c.state();
      for (let i = 0; i < 30 && !state.game_over; i++) {
        let guard = 0;
        while (guard++ < 8) {
          const cur = await c.state();
          if (cur.game_over) break;
          const left = Math.min(...cur.piece.cells.map((p) => p[0]));
          if (left === 0) break;
          if (!(await c.input('left')).legal) break;
        }
        state = (await c.input('hard_drop')).state;
      }
      assert(state.game_over === true,
        'stacking 30 O pieces in one column must end the game — the board is only 20 rows tall');
      assert(state.piece === null, 'piece must be null once the game is over');
      const dead = await c.input('left');
      assert(dead.legal === false, 'every action after game over must report legal:false');
      return 'tops out and stays dead';
    },
  },
  {
    name: 'live updates',
    detail: 'the game pushes update messages for the scoreboard',
    async run(c) {
      await c.newGame({ seed: 'arena' });
      await sleep(600);
      const u = c.lastUpdate;
      assert(u, 'no unprompted "update" messages received — the big screen has nothing to display');
      checkStateShape(u, 'update');
      return 'streaming';
    },
  },
];

/* ------------------------------------------------------------- the runner -- */

export async function runConformance(client, onProgress = () => {}) {
  const results = [];
  for (const test of TESTS) {
    onProgress({ phase: 'start', name: test.name, detail: test.detail });
    const started = Date.now();
    let result;
    try {
      const note = await test.run(client);
      result = { name: test.name, detail: test.detail, pass: true, note: note || '', ms: Date.now() - started };
    } catch (err) {
      result = {
        name: test.name,
        detail: test.detail,
        pass: false,
        note: String((err && err.message) || err),
        ms: Date.now() - started,
      };
    }
    results.push(result);
    onProgress({ phase: 'end', ...result });
    // A game that never says ready will fail everything; stop and say so once.
    if (!result.pass && test.name === 'ready handshake') break;
  }
  return {
    pass: results.every((r) => r.pass) && results.length === TESTS.length,
    total: TESTS.length,
    ran: results.length,
    passed: results.filter((r) => r.pass).length,
    results,
  };
}

export function formatReport(summary, gameName = 'your game') {
  const lines = [
    `Tetris Protocol v2 conformance — ${gameName}`,
    `${summary.passed}/${summary.total} checks passed`,
    '',
  ];
  for (const r of summary.results) {
    lines.push(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.pass ? r.note : r.note}`);
  }
  const failed = summary.results.filter((r) => !r.pass);
  if (failed.length) {
    lines.push('', 'Fix these:', ...failed.map((r) => `- [${r.name}] ${r.note}`));
    lines.push('', 'Relevant spec sections: PROTOCOL.md §3 (randomizer), §4 (clock), §5 (actions), §7 (messages).');
  }
  return lines.join('\n');
}

export const TEST_COUNT = TESTS.length;
