/*
 * Tetris Protocol v2 — drop-in message adapter.
 *
 * Include it with a plain script tag, after your game code:
 *
 *     <script src="./game-adapter.js"></script>
 *     <script>
 *       const adapter = installTetrisAdapter({
 *         name:   'Neon Blocks',
 *         author: 'your name',
 *         getState: ()       => myGame.toProtocolState(),
 *         onNew:    (opts)   => myGame.restart(opts),      // {seed, sequence}
 *         onInput:  (action) => myGame.applyAction(action), // -> true if legal
 *         onPause:  (paused) => myGame.setPaused(paused),
 *       });
 *       // call this whenever the state changes (lock, clear, game over, ...)
 *       adapter.notify();
 *     </script>
 *
 * You still have to write the game. This only handles talking to the Arena.
 * See PROTOCOL.md §7 for the message interface this implements.
 */
function installTetrisAdapter(hooks) {
  var PROTO = 'tetris/2';
  var required = ['getState', 'onNew', 'onInput'];
  for (var i = 0; i < required.length; i++) {
    if (typeof hooks[required[i]] !== 'function') {
      throw new Error('installTetrisAdapter: missing required hook ' + required[i]);
    }
  }

  var lastSent = '';
  var updateTimer = null;

  function host() {
    // The Arena loads the game in an iframe. Running standalone must not throw.
    return (window.parent && window.parent !== window) ? window.parent : null;
  }

  function post(msg) {
    var target = host();
    if (!target) return;
    msg.proto = PROTO;
    try {
      target.postMessage(msg, '*');
    } catch (err) {
      /* the Arena may have gone away mid-match; never let this break the game */
    }
  }

  function safeState() {
    var state = hooks.getState();
    if (!state || typeof state !== 'object') throw new Error('getState() returned no state');
    return state;
  }

  /* Push the current state to the Arena. Call it on every state change.
     Identical consecutive states are suppressed, so calling it often is cheap. */
  function notify() {
    var state;
    try {
      state = safeState();
    } catch (err) {
      return;
    }
    var encoded;
    try {
      encoded = JSON.stringify(state);
    } catch (err) {
      return; // a circular or non-JSON-safe state is a bug in getState()
    }
    if (encoded === lastSent) return;
    lastSent = encoded;
    post({ type: 'update', payload: JSON.parse(encoded) });
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || msg.proto !== PROTO || typeof msg.type !== 'string') return;
    if (msg.type === 'result' || msg.type === 'update' || msg.type === 'ready') return;

    var reply = { id: msg.id, type: 'result', ok: true, payload: null };
    var payload = msg.payload || {};

    try {
      switch (msg.type) {
        case 'new':
          hooks.onNew({
            seed: typeof payload.seed === 'string' ? payload.seed : 'arena',
            sequence: typeof payload.sequence === 'string' ? payload.sequence : null,
          });
          reply.payload = safeState();
          break;

        case 'state':
          reply.payload = safeState();
          break;

        case 'input':
          var legal = hooks.onInput(payload.action);
          reply.payload = { legal: legal === true, state: safeState() };
          break;

        case 'pause':
          if (typeof hooks.onPause === 'function') hooks.onPause(payload.paused === true);
          reply.payload = safeState();
          break;

        default:
          reply.ok = false;
          reply.payload = { error: 'unknown message type: ' + msg.type };
      }
    } catch (err) {
      reply.ok = false;
      reply.payload = { error: String((err && err.message) || err) };
    }

    // Reply to whoever asked, not to a remembered parent.
    try {
      if (event.source) event.source.postMessage(Object.assign({ proto: PROTO }, reply), '*');
    } catch (e) {
      post(reply);
    }

    lastSent = ''; // force the next notify() through, state has probably changed
  });

  // Tell the Arena we exist. Without this the submission is rejected.
  post({ type: 'ready', payload: { name: hooks.name || 'Untitled', author: hooks.author || '' } });

  // The protocol requires at least 10 updates/second while playing. Your own
  // notify() calls cover state changes; this covers the timer ticking down.
  updateTimer = setInterval(notify, 100);

  return {
    notify: notify,
    stop: function () { clearInterval(updateTimer); },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { installTetrisAdapter: installTetrisAdapter };
