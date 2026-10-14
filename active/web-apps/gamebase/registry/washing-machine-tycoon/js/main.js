// main.js — Entry point, bootstraps the game
// ====================================================================

(function() {
  'use strict';

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    console.log('🧺 Washing Machine Tycoon — booting...');

    // Register service worker? Not needed for now.

    // Start the game
    UI.startGame();
  }

})();
