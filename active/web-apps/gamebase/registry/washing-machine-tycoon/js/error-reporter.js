// error-reporter.js — Automatic console error reporting
// ====================================================================
// Hooks window.onerror and unhandledrejection, stores errors,
// and exposes them for in-game viewing.

const ErrorReporter = {
  errors: [],
  maxErrors: 50,
  _initialized: false,
};

ErrorReporter.init = function() {
  if (ErrorReporter._initialized) return;
  ErrorReporter._initialized = true;

  // Store original handlers
  const origOnError = window.onerror;
  const origOnRejection = window.onunhandledrejection;

  window.onerror = function(msg, source, line, col, error) {
    const err = {
      type: 'error',
      message: typeof msg === 'object' && msg !== null ? (msg.message || String(msg)) : String(msg),
      source: source || 'unknown',
      line: line || 0,
      col: col || 0,
      stack: error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : '',
      time: Date.now(),
      timestamp: new Date().toISOString(),
    };
    ErrorReporter._add(err);

    // Forward to original handler if one existed
    if (typeof origOnError === 'function') {
      return origOnError(msg, source, line, col, error);
    }
    return false;
  };

  window.onunhandledrejection = function(event) {
    const reason = event.reason || {};
    const err = {
      type: 'promise',
      message: reason.message || String(reason),
      stack: reason.stack ? reason.stack.split('\n').slice(0, 4).join('\n') : '',
      time: Date.now(),
      timestamp: new Date().toISOString(),
      source: 'unhandledrejection',
    };
    ErrorReporter._add(err);

    if (typeof origOnRejection === 'function') {
      origOnRejection(event);
    }
  };

  // Also hook console.error for direct error logs
  const origConsoleError = console.error;
  console.error = function() {
    const args = Array.from(arguments);
    const err = {
      type: 'console',
      message: args.map(a => typeof a === 'object' ? (a.message || JSON.stringify(a).slice(0, 200)) : String(a)).join(' '),
      time: Date.now(),
      timestamp: new Date().toISOString(),
      stack: new Error().stack?.split('\n').slice(2, 5).join('\n') || '',
    };
    ErrorReporter._add(err);
    origConsoleError.apply(console, args);
  };

  console.log('📋 ErrorReporter active — tracking JS errors for debugging');
};

ErrorReporter._add = function(err) {
  ErrorReporter.errors.push(err);
  if (ErrorReporter.errors.length > ErrorReporter.maxErrors) {
    ErrorReporter.errors.shift();
  }

  // Also store in localStorage for crash recovery
  try {
    const stored = JSON.parse(localStorage.getItem('wmt_errors') || '[]');
    stored.push({ message: err.message, time: err.time, type: err.type });
    if (stored.length > 20) stored.splice(0, stored.length - 20);
    localStorage.setItem('wmt_errors', JSON.stringify(stored));
  } catch(e) { /* silent */ }

  // Show notification for critical errors
  if (ErrorReporter.errors.length <= 3 && typeof UI !== 'undefined' && UI.showMessage) {
    UI.showMessage(`⚠️ Script error logged — check Error Log on Dashboard`, 5000);
  }
};

ErrorReporter.getRecent = function(n) {
  return ErrorReporter.errors.slice(-(n || 10)).reverse();
};

ErrorReporter.getCount = function() {
  return ErrorReporter.errors.length;
};

ErrorReporter.clear = function() {
  ErrorReporter.errors = [];
  localStorage.removeItem('wmt_errors');
};
