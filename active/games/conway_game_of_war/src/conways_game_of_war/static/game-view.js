/**
 * game-view.js — Map‑like navigation for Conway's Game of War.
 *
 * Features:
 *   • Mouse‑drag panning (click‑and‑drag)
 *   • Scroll‑wheel zoom (toward cursor)
 *   • Double‑click / double‑tap to zoom in
 *   • One‑finger touch pan
 *   • Two‑finger pinch‑zoom + rotate
 *   • Minimap overview (canvas) with red viewport rectangle + click‑to‑navigate
 *   • Zoom indicator overlay
 *   • Keyboard: ←↑↓→ pan, +/- zoom, 0 reset view, R reset rotation
 *   • HTMX integration: re‑applies transform after board swaps
 */
(function () {
  'use strict';

  // ─── helpers ────────────────────────────────────────────────────────

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const deg = (rad) => (rad * 180) / Math.PI;

  // ─── GameView ───────────────────────────────────────────────────────

  class GameView {
    /**
     * @param {HTMLElement} viewport  The #viewport element.
     */
    constructor(viewport) {
      this.viewport = viewport;
      this.wrapper = viewport.querySelector('.game-wrapper');
      this.game = document.getElementById('game');

      /** Track whether the board has been initially fitted. */
      this._fitted = false;
      this._boardDimSig = '';

      /**
       * View state.
       * @type {{ x:number, y:number, scale:number, rotate:number }}
       */
      this.state = { x: 0, y: 0, scale: 1, rotate: 0 };

      // ── drag state ──
      this._dragging = false;
      this._dragStart = { x: 0, y: 0 };
      this._stateOnDragStart = { x: 0, y: 0 };

      // ── gesture state ──
      this._gesture = null;

      // ── touch state (track movement to distinguish tap vs drag) ──
      this._touchMoved = false;
      this._touchMoveThreshold = 8; // px of movement before it's a drag
      this._lastTapTime = 0;
      this._canDoubleTap = false;

      // ── minimap ──
      this._minimapCanvas = null;
      this._minimapCtx = null;
      this._minimapScale = 1;
      this._minimapDirty = false;

      // ── zoom indicator ──
      /** @type {HTMLElement|null} */
      this._zoomIndicator = document.getElementById('zoom-indicator');
      this._zoomIndicatorTimer = null;

      // ── bind events ──
      this._bindEvents();
    }

    // ─── public ───────────────────────────────────────────────────────

    /**
     * Call after the #game element is swapped (HTMX) or on first load.
     */
    refresh() {
      this.game = document.getElementById('game');
      if (!this.game) return;

      // Only run initial fit once the board has real data attributes.
      if (!this._fitted) {
        const hasBbox = this.game.hasAttribute('data-bbox-xmin');
        if (!hasBbox) return; // HTMX hasn't populated yet — wait for next swap.
        this._initialFit();
        this._fitted = true;
        this._storeBoardSignature();
        this._applyTransform();
        this._scheduleMinimap();
        return;
      }

      // Only re-fit when the board *dimensions* change (e.g. after Reset),
      // not when the bbox shifts (game updates, AI moves, cell toggles).
      // Re-fitting on every bbox change would wipe out user zoom/pan.
      if (this._boardDimensionsChanged()) {
        this._initialFit();
        this._boardDimSig = this._readBoardDimSig();
      }

      this._applyTransform();
      this._scheduleMinimap();
    }

    /** Read board width/height signature. */
    _readBoardDimSig() {
      const g = this.game;
      return g
        ? `${g.getAttribute('data-board-w')}x${g.getAttribute('data-board-h')}`
        : '';
    }

    _storeBoardSignature() {
      this._boardDimSig = this._readBoardDimSig();
    }

    /** @returns {boolean} true if board WIDTH or HEIGHT changed. */
    _boardDimensionsChanged() {
      return this._boardDimSig !== this._readBoardDimSig();
    }

    /** Reset view to initial fit (zero rotation, fit bbox). */
    resetView() {
      this._fitted = false;
      this.refresh();
      this._showZoomIndicator();
    }

    // ─── event binding ────────────────────────────────────────────────

    _bindEvents() {
      const vp = this.viewport;

      // Wheel zoom
      vp.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

      // Mouse drag
      vp.addEventListener('mousedown', (e) => this._onMouseDown(e));
      window.addEventListener('mousemove', (e) => this._onMouseMove(e));
      window.addEventListener('mouseup', () => this._onMouseUp());

      // Double‑click zoom in
      vp.addEventListener('dblclick', (e) => this._onDblClick(e));

      // Context menu guard
      vp.addEventListener('contextmenu', (e) => { if (this._dragging) e.preventDefault(); });

      // Touch — non-passive so we can preventDefault to stop browser scroll
      vp.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
      vp.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
      vp.addEventListener('touchend', (e) => this._onTouchEnd(e));
      vp.addEventListener('touchcancel', () => this._onTouchEnd());

      // iOS Safari fires gesture events (gesturestart/change/end) during
      // multi-touch.  They trigger the browser's built-in pinch-zoom which
      // fights our custom handler.  Prevent them outright.
      vp.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
      vp.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });

      // HTMX
      document.addEventListener('htmx:afterSwap', (evt) => {
        if (evt.detail && evt.detail.target && evt.detail.target.id === 'game') {
          // When the board is fully replaced (Reset), clear the fitted flag
          // so that the view re-fits to the new board.
          const path = evt.detail.pathInfo?.requestPath || '';
          if (path === '/reset') {
            this._fitted = false;
          }
          this.refresh();
        }
      });

      // Resize
      window.addEventListener('resize', () => this._scheduleMinimap());

      // Keyboard
      document.addEventListener('keydown', (e) => this._onKey(e));

      // ── help overlay ──
      document.addEventListener('keydown', (e) => this._onKeyGlobal(e));
      document.addEventListener('click', (e) => this._onClickGlobal(e));

      // ── help button ──
      const helpBtn = document.getElementById('help-btn');
      if (helpBtn) helpBtn.addEventListener('click', () => this._toggleHelp());

      // ── minimap toggle ──
      const mmBtn = document.getElementById('minimap-toggle');
      if (mmBtn) mmBtn.addEventListener('click', () => this._toggleMinimap());
    }

    // ─── help overlay ──────────────────────────────────────────────────

    _toggleHelp() {
      const overlay = document.getElementById('help-overlay');
      if (!overlay) return;
      overlay.classList.toggle('open');
    }

    // ─── minimap toggle ───────────────────────────────────────────────

    _toggleMinimap() {
      const mm = document.getElementById('minimap');
      if (!mm) {
        // If minimap hasn't been created yet, force creation by scheduling paint
        this._minimapCanvas = null; // reset so _ensureMinimapDOM runs again
        this._scheduleMinimap();
        return;
      }
      mm.style.display = mm.style.display === 'none' ? '' : 'none';
      if (mm.style.display !== 'none') {
        this._scheduleMinimap();
      }
    }

    // ─── initial fit ──────────────────────────────────────────────────

    _initialFit() {
      const game = this.game;
      if (!game) { this.state = { x: 0, y: 0, scale: 1, rotate: 0 }; return; }

      const xmin = parseInt(game.getAttribute('data-bbox-xmin'));
      const ymin = parseInt(game.getAttribute('data-bbox-ymin'));
      const xmax = parseInt(game.getAttribute('data-bbox-xmax'));
      const ymax = parseInt(game.getAttribute('data-bbox-ymax'));
      const cellPx = parseInt(game.getAttribute('data-cell-px')) || 12;
      const pad = 3;

      const wCells = (xmax - xmin + 1) + pad * 2;
      const hCells = (ymax - ymin + 1) + pad * 2;
      const wPx = wCells * cellPx;
      const hPx = hCells * cellPx;

      const vw = this.viewport.clientWidth;
      const vh = this.viewport.clientHeight;

      const scale = Math.max(0.1, Math.min(vw / wPx, vh / hPx, 1));

      const bboxCx = (xmin + xmax) / 2;
      const bboxCy = (ymin + ymax) / 2;
      const boardMidX = bboxCx * cellPx + cellPx / 2;
      const boardMidY = bboxCy * cellPx + cellPx / 2;

      this.state = {
        x: vw / 2 - boardMidX * scale,
        y: vh / 2 - boardMidY * scale,
        scale,
        rotate: 0,
      };

      this._showZoomIndicator();
    }

    // ─── transform ────────────────────────────────────────────────────

    _applyTransform() {
      let w = this.wrapper;
      if (!w) {
        // Re-query in case the DOM was manipulated outside of HTMX swaps
        w = this.viewport.querySelector('.game-wrapper');
        this.wrapper = w;
        if (!w) return;
      }

      let { x, y, scale, rotate } = this.state;

      // NaN guard — if any state value is NaN the CSS transform would be
      // silently ignored by the browser, making the board unresponsive.
      // Fall back to a safe identity transform instead.
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          !Number.isFinite(scale) || !Number.isFinite(rotate)) {
        console.error('GameView: NaN detected in state', { x, y, scale, rotate });
        x = 0; y = 0; scale = 1; rotate = 0;
      }

      const cx = this.viewport.clientWidth / 2;
      const cy = this.viewport.clientHeight / 2;

      w.style.transformOrigin = `${cx}px ${cy}px`;
      w.style.transform =
        `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotate}deg)`;
      w.style.willChange = 'transform';
    }

    // ─── zoom ─────────────────────────────────────────────────────────

    _zoomAt(mx, my, factor) {
      const s = this.state;
      const curScale = Number.isFinite(s.scale) && s.scale > 0 ? s.scale : 1;
      const newScale = clamp(curScale * factor, 0.05, 40);
      // Approximate inverse: treat current transform as translate+scale.
      const curX = Number.isFinite(s.x) ? s.x : 0;
      const curY = Number.isFinite(s.y) ? s.y : 0;
      const wx = (mx - curX) / curScale;
      const wy = (my - curY) / curScale;
      s.scale = newScale;
      s.x = mx - wx * newScale;
      s.y = my - wy * newScale;
      this._applyTransform();
      this._scheduleMinimap();
      this._showZoomIndicator();
    }

    // ─── zoom indicator ───────────────────────────────────────────────

    _showZoomIndicator() {
      const el = this._zoomIndicator;
      if (!el) return;
      el.textContent = `${Math.round(this.state.scale * 100)}%`;
      el.classList.add('show');
      clearTimeout(this._zoomIndicatorTimer);
      this._zoomIndicatorTimer = setTimeout(() => el.classList.remove('show'), 1200);
    }

    // ─── mouse wheel ──────────────────────────────────────────────────

    _onWheel(e) {
      e.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this._zoomAt(mx, my, e.deltaY < 0 ? 1.08 : 1 / 1.08);
    }

    // ─── double‑click zoom ────────────────────────────────────────────

    _onDblClick(e) {
      const rect = this.viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this._zoomAt(mx, my, 2);
    }

    // ─── mouse drag ───────────────────────────────────────────────────

    _onMouseDown(e) {
      if (e.button !== 0) return;
      this._dragging = true;
      this._dragStart = { x: e.clientX, y: e.clientY };
      this._stateOnDragStart = { ...this.state };
      this.viewport.style.cursor = 'grabbing';
    }

    _onMouseMove(e) {
      if (!this._dragging) return;
      const dx = e.clientX - this._dragStart.x;
      const dy = e.clientY - this._dragStart.y;
      this.state.x = this._stateOnDragStart.x + dx;
      this.state.y = this._stateOnDragStart.y + dy;
      this._applyTransform();
      this._scheduleMinimap();
    }

    _onMouseUp() {
      this._dragging = false;
      this.viewport.style.cursor = 'grab';
    }

    // ─── touch ────────────────────────────────────────────────────────

    _onTouchStart(e) {
      // Don't start gesture if touch is on the minimap
      if (e.target && e.target.closest && e.target.closest('#minimap')) return;

      // Prevent browser scroll / zoom
      e.preventDefault();

      this._touchMoved = false;

      if (e.touches.length === 1) {
        const t = e.touches[0];
        this._gesture = {
          type: 'pan',
          startX: t.clientX,
          startY: t.clientY,
          stateAtStart: { ...this.state },
          time: Date.now(),
        };
        this._lastTapTime = Date.now();
      } else if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        // Dist and angle helpers expect {x, y} — Touch objects use clientX/Y
        const p1 = { x: t1.clientX, y: t1.clientY };
        const p2 = { x: t2.clientX, y: t2.clientY };
        this._gesture = {
          type: 'pinch',
          cx: (t1.clientX + t2.clientX) / 2,
          cy: (t1.clientY + t2.clientY) / 2,
          dist: dist(p1, p2),
          angle: angle(p1, p2),
          stateAtStart: { ...this.state },
        };
      }
    }

    _onTouchMove(e) {
      if (!this._gesture) return;

      if (this._gesture.type === 'pan' && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - this._gesture.startX;
        const dy = t.clientY - this._gesture.startY;

        // Only apply pan if movement exceeds the drag threshold.
        // Below threshold = treat as stationary tap.
        if (Math.abs(dx) > this._touchMoveThreshold || Math.abs(dy) > this._touchMoveThreshold) {
          this._touchMoved = true;
          const sx = Number.isFinite(this._gesture.stateAtStart.x) ? this._gesture.stateAtStart.x : 0;
          const sy = Number.isFinite(this._gesture.stateAtStart.y) ? this._gesture.stateAtStart.y : 0;
          this.state.x = sx + dx;
          this.state.y = sy + dy;
          this._applyTransform();
          this._scheduleMinimap();
        }
      } else if (this._gesture.type === 'pinch' && e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const p1 = { x: t1.clientX, y: t1.clientY };
        const p2 = { x: t2.clientX, y: t2.clientY };
        const newDist = dist(p1, p2);
        const newAngle = angle(p1, p2);
        const s = this._gesture.stateAtStart;

        // NaN guards for pinch calculations
        const baseDist = Number.isFinite(this._gesture.dist) && this._gesture.dist > 0
          ? this._gesture.dist : 40;
        const baseScale = Number.isFinite(s.scale) && s.scale > 0 ? s.scale : 1;
        const baseX = Number.isFinite(s.x) ? s.x : 0;
        const baseY = Number.isFinite(s.y) ? s.y : 0;
        const baseRotate = Number.isFinite(s.rotate) ? s.rotate : 0;
        const baseAngle = Number.isFinite(this._gesture.angle) ? this._gesture.angle : 0;
        const curDist = Number.isFinite(newDist) ? newDist : baseDist;
        const curAngle = Number.isFinite(newAngle) ? newAngle : baseAngle;

        const factor = curDist / baseDist;
        const newScale = clamp(baseScale * factor, 0.05, 40);

        const rect = this.viewport.getBoundingClientRect();
        const cx = (t1.clientX + t2.clientX) / 2 - rect.left;
        const cy = (t1.clientY + t2.clientY) / 2 - rect.top;
        const wx = (cx - baseX) / baseScale;
        const wy = (cy - baseY) / baseScale;

        this.state.scale = newScale;
        this.state.x = cx - wx * newScale;
        this.state.y = cy - wy * newScale;

        const rotDelta = deg(curAngle - baseAngle);
        this.state.rotate = baseRotate + rotDelta;

        this._gesture.cx = (t1.clientX + t2.clientX) / 2;
        this._gesture.cy = (t1.clientY + t2.clientY) / 2;
        this._gesture.dist = curDist;
        this._gesture.angle = curAngle;
        this._gesture.stateAtStart = { ...this.state };

        this._applyTransform();
        this._scheduleMinimap();
      }
    }

    _onTouchEnd(e) {
      if (this._gesture && this._gesture.type === 'pan') {
        // If the finger didn't move much, it's a tap — let the click through
        if (!this._touchMoved) {
          // Re-dispatch a click event on the touched element so HTMX fires
          if (e && e.changedTouches && e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (target) {
              target.click();
            }
          }
        }

        // Double‑tap detection for zoom
        const now = Date.now();
        // Use 350ms for both the inter-tap gap and the gesture age.
        // The gesture-time check is intentionally generous to handle
        // async event dispatch where touchstart→touchend can be
        // significantly longer than the sub-ms real finger lift.
        if (this._canDoubleTap && now - this._lastTapTime < 350 && now - this._gesture.time < 350) {
          const vw = this.viewport.clientWidth;
          const vh = this.viewport.clientHeight;
          this._zoomAt(vw / 2, vh / 2, 2);
        }
        this._canDoubleTap = !this._touchMoved;
      }
      this._gesture = null;
    }

    // ─── keyboard (game view only) ───────────────────────────────────

    _onKey(e) {
      // Ignore when user is typing in an input.
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const STEP = 40; // px per arrow key
      const ZOOM_STEP = 1.15;

      switch (e.key) {
        // Map‑like: arrow keys move the *view* (translate content opposite).
        case 'ArrowUp':    e.preventDefault(); this.state.y += STEP; break;
        case 'ArrowDown':  e.preventDefault(); this.state.y -= STEP; break;
        case 'ArrowLeft':  e.preventDefault(); this.state.x += STEP; break;
        case 'ArrowRight': e.preventDefault(); this.state.x -= STEP; break;
        case '+': case '=': e.preventDefault(); this._zoomAt(this.viewport.clientWidth / 2, this.viewport.clientHeight / 2, ZOOM_STEP); return;
        case '-': case '_': e.preventDefault(); this._zoomAt(this.viewport.clientWidth / 2, this.viewport.clientHeight / 2, 1 / ZOOM_STEP); return;
        case '0': e.preventDefault(); this.resetView(); return;
        case 'r': case 'R': e.preventDefault(); this.state.rotate = 0; this._applyTransform(); this._scheduleMinimap(); this._showZoomIndicator(); return;
        default: return;
      }
      this._applyTransform();
      this._scheduleMinimap();
    }

    /** Global key handler (help overlay, etc.). */
    _onKeyGlobal(e) {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('help-overlay');
        if (overlay && overlay.classList.contains('open')) {
          overlay.classList.remove('open');
          e.preventDefault();
        }
      }
    }

    /** Global click handler — close help when clicking outside the card. */
    _onClickGlobal(e) {
      const overlay = document.getElementById('help-overlay');
      if (!overlay || !overlay.classList.contains('open')) return;
      if (e.target === overlay) {
        overlay.classList.remove('open');
      }
    }

    // ─── minimap ──────────────────────────────────────────────────────

    _scheduleMinimap() {
      if (this._minimapDirty) return;
      this._minimapDirty = true;
      requestAnimationFrame(() => {
        this._minimapDirty = false;
        this._paintMinimap();
      });
    }

    _ensureMinimapDOM() {
      if (this._minimapCanvas) return;

      const container = document.createElement('div');
      container.id = 'minimap';
      container.className = 'minimap';

      const canvas = document.createElement('canvas');
      canvas.id = 'minimap-canvas';
      container.appendChild(canvas);

      const label = document.createElement('span');
      label.className = 'minimap-label';
      label.textContent = '⌂';
      container.appendChild(label);

      this.viewport.appendChild(container);
      this._minimapCanvas = canvas;
      this._minimapCtx = canvas.getContext('2d');

      // Click (desktop) — re-centre viewport on clicked position
      canvas.addEventListener('click', (e) => this._onMinimapClick(e));

      // Touch (mobile) — drag on the minimap to pan the playfield.
      // We stop propagation so the viewport's gesture handler doesn't
      // also interpret the minimap touch, but we handle it ourselves.
      this._minimapTouchState = null;
      canvas.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const t = e.changedTouches[0];
        this._minimapTouchState = {
          startX: t.clientX,
          startY: t.clientY,
          stateAtStart: { ...this.state },
        };
      }, { passive: false });
      canvas.addEventListener('touchmove', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!this._minimapTouchState) return;
        const t = e.changedTouches[0];
        const dx = (t.clientX - this._minimapTouchState.startX) / this._minimapScale;
        const dy = (t.clientY - this._minimapTouchState.startY) / this._minimapScale;
        // Convert minimap-pixel deltas to board-pixel deltas
        this.state.x = this._minimapTouchState.stateAtStart.x + dx * this.state.scale;
        this.state.y = this._minimapTouchState.stateAtStart.y + dy * this.state.scale;
        this._applyTransform();
        this._scheduleMinimap();
      }, { passive: false });
      canvas.addEventListener('touchend', (e) => {
        e.stopPropagation();
        this._minimapTouchState = null;
      });
      canvas.addEventListener('touchcancel', () => {
        this._minimapTouchState = null;
      });
    }

    _paintMinimap() {
      const game = this.game;
      if (!game) return;

      const boardW = parseInt(game.getAttribute('data-board-w')) || 127;
      const boardH = parseInt(game.getAttribute('data-board-h')) || 131;
      if (boardW <= 0 || boardH <= 0) return;

      this._ensureMinimapDOM();

      const maxW = 180;
      const aspect = boardW / boardH;
      const mw = Math.min(maxW, boardW);
      const mh = Math.round(mw / aspect) || 1;

      const canvas = this._minimapCanvas;
      const ctx = this._minimapCtx;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = mw * dpr;
      canvas.height = mh * dpr;
      canvas.style.width = mw + 'px';
      canvas.style.height = mh + 'px';
      ctx.scale(dpr, dpr);

      this._minimapScale = mw / boardW;

      const rows = game.querySelectorAll('tr');
      ctx.clearRect(0, 0, mw, mh);

      rows.forEach((tr, rowY) => {
        const cells = tr.querySelectorAll('td');
        cells.forEach((td, colX) => {
          const bg = td.style.backgroundColor;
          if (!bg) return;
          const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!match) return;
          const r = parseInt(match[1]);
          const g = parseInt(match[2]);
          const b = parseInt(match[3]);
          if (r < 55 && g < 55 && b < 55) return;

          const x = colX * this._minimapScale;
          const y = rowY * this._minimapScale;
          const sz = Math.max(1, Math.ceil(this._minimapScale));
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x, y, sz, sz);
        });
      });

      this._drawViewportRect(ctx, mw, mh);
    }

    _drawViewportRect(ctx, mw, mh) {
      const s = this.state;
      const vw = this.viewport.clientWidth;
      const vh = this.viewport.clientHeight;

      const inv = (px, py) => ({
        bx: (px - s.x) / s.scale,
        by: (py - s.y) / s.scale,
      });

      const tl = inv(0, 0);
      const br = inv(vw, vh);

      const sc = this._minimapScale;
      const rx = tl.bx * sc;
      const ry = tl.by * sc;
      const rw = (br.bx - tl.bx) * sc;
      const rh = (br.by - tl.by) * sc;

      // Clamp to minimap bounds
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, mw, mh);
      ctx.clip();

      ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx, ry, rw, rh);

      // Dim outside viewport
      ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
      ctx.fillRect(0, 0, mw, Math.max(0, ry));
      ctx.fillRect(0, ry + rh, mw, Math.max(0, mh - ry - rh));
      ctx.fillRect(0, ry, Math.max(0, rx), rh);
      ctx.fillRect(rx + rw, ry, Math.max(0, mw - rx - rw), rh);

      ctx.restore();
    }

    _onMinimapClick(e) {
      const rect = this._minimapCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const bx = mx / this._minimapScale;
      const by = my / this._minimapScale;

      const s = this.state;
      const vw = this.viewport.clientWidth;
      const vh = this.viewport.clientHeight;
      s.x = vw / 2 - bx * s.scale;
      s.y = vh / 2 - by * s.scale;

      this._applyTransform();
      this._scheduleMinimap();
    }
  }

  // ─── boot ───────────────────────────────────────────────────────────

  function boot() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;

    const gv = new GameView(viewport);
    window.__gameView = gv; // for debugging

    // Attempt initial refresh — if the board hasn't been populated by
    // HTMX yet (no data attributes), refresh() will return early and
    // the htmx:afterSwap handler will retry.
    gv.refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
