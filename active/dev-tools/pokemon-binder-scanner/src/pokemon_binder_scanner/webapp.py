from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, flash, jsonify, redirect, render_template_string, request, send_file, url_for
from PIL import Image, ImageDraw, ImageOps

from .binder_fixtures import DEFAULT_MANIFEST_PATH, load_manifest
from .scanner import scan_fixture_image, faiss_scan_image, load_faiss_index, load_clip_index, clip_scan_image, load_clip_adapter

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(16))

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

APPRAISER_TEMPLATE = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <title>Pokemon Binder Scanner</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a1628;
        --surface: #0f1d33;
        --border: rgba(148, 163, 184, 0.18);
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #60a5fa;
        --good: #34d399;
        --bad: #f87171;
      }
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: system-ui, -apple-system, sans-serif;
        background: linear-gradient(180deg, #0a1628 0%, #060e1a 100%);
        color: var(--text);
        min-height: 100vh;
      }
      .app {
        max-width: 900px;
        margin: 0 auto;
        padding: 20px 16px 40px;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 20px;
      }
      header h1 {
        font-size: 1.25rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      header .badge {
        font-size: 0.78rem;
        color: var(--muted);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 99px;
        padding: 4px 12px;
      }
      .dropzone {
        border: 2px dashed rgba(96, 165, 250, 0.35);
        border-radius: 16px;
        padding: 40px 20px;
        text-align: center;
        cursor: pointer;
        transition: 160ms ease;
        background: rgba(96, 165, 250, 0.04);
        margin-bottom: 20px;
      }
      .dropzone:hover, .dropzone.dragover {
        border-color: var(--accent);
        background: rgba(96, 165, 250, 0.10);
      }
      .dropzone.dragover { transform: translateY(-1px); }
      .dropzone p { color: var(--muted); font-size: 0.95rem; }
      .dropzone .icon { font-size: 2rem; margin-bottom: 8px; display: block; }
      input[type=file] { display: none; }

      .loading {
        display: none;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 16px;
        color: var(--muted);
      }
      .loading.visible { display: flex; }
      .spinner {
        width: 20px; height: 20px;
        border-radius: 50%;
        border: 2.5px solid rgba(148,163,184,0.25);
        border-top-color: var(--accent);
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      .result { display: none; }
      .result.visible { display: block; }

      .image-stage {
        position: relative;
        border-radius: 16px;
        overflow: hidden;
        background: #000;
        margin-bottom: 16px;
      }
      .image-stage img {
        display: block;
        width: 100%;
        height: auto;
        max-height: 70vh;
        object-fit: contain;
      }
      .image-stage canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .toggle-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding: 10px 14px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        margin-bottom: 16px;
      }
      .toggle-bar button {
        border: 0;
        border-radius: 99px;
        padding: 7px 16px;
        font: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        background: rgba(96,165,250,0.15);
        color: var(--accent);
        transition: 120ms ease;
      }
      .toggle-bar button.active {
        background: var(--accent);
        color: #000;
      }
      .toggle-bar .meta {
        color: var(--muted);
        font-size: 0.88rem;
        margin-left: auto;
      }

      .cards-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }
      .cards-table th {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        color: var(--muted);
        font-weight: 600;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .cards-table td {
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148,163,184,0.08);
        vertical-align: middle;
      }
      .cards-table .name { font-weight: 600; }
      .cards-table .id { color: var(--muted); font-size: 0.82rem; }
      .cards-table .price { font-variant-numeric: tabular-nums; }
      .feedback-buttons { display: flex; gap: 6px; }
      .feedback-buttons button {
        border: 1px solid var(--border);
        border-radius: 99px;
        padding: 5px 10px;
        font-size: 0.85rem;
        cursor: pointer;
        background: transparent;
        color: var(--muted);
      }
      .feedback-buttons button:hover { background: rgba(96,165,250,0.12); }
      .feedback-status { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }

      .empty-state { text-align: center; color: var(--muted); padding: 40px 20px; }

      .scanning-overlay {
        position: absolute;
        inset: 0;
        background: rgba(10, 22, 40, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(2px);
        transition: opacity 0.3s ease;
        z-index: 2;
      }
      .scanning-overlay.hidden { opacity: 0; pointer-events: none; }
      .scanning-pulse {
        width: 60px; height: 60px;
        border-radius: 50%;
        border: 3px solid rgba(96, 165, 250, 0.2);
        border-top-color: var(--accent);
        animation: spin 0.8s linear infinite;
        box-shadow: 0 0 30px rgba(96, 165, 250, 0.15);
      }
      .scanning-text {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        color: var(--accent);
        font-size: 0.9rem;
        font-weight: 600;
        text-shadow: 0 0 20px rgba(96, 165, 250, 0.5);
        animation: pulse-text 1.5s ease-in-out infinite;
      }
      @keyframes pulse-text {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }

      @media (max-width: 600px) {
        .app { padding: 12px 10px 32px; }
        .cards-table th, .cards-table td { padding: 8px 6px; }
        .cards-table { font-size: 0.82rem; }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header>
        <h1>Pokemon Binder Scanner</h1>
        <span class="badge">{{ catalog_summary.unique_cards }} reference cards</span>
      </header>

      <div class="dropzone" id="dropzone">
        <span class="icon">📷</span>
        <p>Drop a binder page photo here or click to upload</p>
        <input id="file-input" type="file" name="images" accept=".jpg,.jpeg,.png,.webp,image/*" />
      </div>

      <div class="loading" id="loading">
        <div class="spinner"></div>
        <span>Scanning cards…</span>
      </div>

      <div class="result" id="result">
        <div class="image-stage" id="image-stage">
          <img id="source-image" src="" alt="binder page" style="display:none;" />
          <canvas id="overlay-canvas"></canvas>
          <div class="scanning-overlay hidden" id="scanning-overlay">
            <div class="scanning-pulse"></div>
            <div class="scanning-text">Identifying cards…</div>
          </div>
        </div>

        <div class="toggle-bar">
          <button id="btn-overlay" class="active" onclick="toggleOverlay()">Show overlay</button>
          <button id="btn-names" class="active" onclick="toggleNames()">Names</button>
          <button id="btn-prices" class="active" onclick="togglePrices()">Prices</button>
          <span class="meta" id="scan-meta">{% if results %}{% for result in results %}<span id="scan-meta-text">{{ result.slot_count }} cards &middot; ${{ '%.2f' % result.predicted_total_usd }}</span>{% endfor %}{% endif %}</span>
        </div>

        <table class="cards-table" id="cards-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Card</th>
              <th>Variant</th>
              <th>Price</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="cards-tbody">
            {% if results %}
              {% for result in results %}
                {% for slot in result.slots %}
                  <tr>
                    <td>{{ loop.index }}</td>
                    <td>
                      <div class="name"><strong>{{ slot.card.name }}</strong></div>
                      <div class="id"><span class="muted">{{ slot.card.canonical_card_id }}</span></div>
                    </td>
                    <td>
                        <select class="variant-select" data-slot-id="{{ slot.slot_id }}" 
                                onchange="onVariantChange(this)" style="
                                  background:rgba(15,23,42,0.84);color:#e2e8f0;
                                  border:1px solid rgba(148,163,184,0.22);
                                  border-radius:8px;padding:4px 6px;font:inherit;
                                  font-size:0.82rem;max-width:130px;">
                          {% set var_opts = result.variant_options.get(slot.slot_id, []) %}
                          {% for vo in var_opts %}
                            <option value="{{ vo.canonical_card_id }}" 
                                    data-variant="{{ vo.variant }}"
                                    data-price="{{ '%.2f' % vo.price }}"
                                    {% if vo.canonical_card_id == slot.card.canonical_card_id %}selected{% endif %}>
                              {{ vo.variant }}
                            </option>
                          {% endfor %}
                        </select>
                      </td>
                      <td>${{ '%.2f' % slot.card.fixture_price_usd }}<br>
                        <a href="https://prices.pokemontcg.io/tcgplayer/{{ slot.card.canonical_card_id }}" 
                           target="_blank" rel="noopener" 
                           style="font-size:0.75rem;color:var(--muted);text-decoration:none;">
                          Buy on TCGPlayer ↗
                        </a>
                      </td>
                    <td>
                      <form class="feedback-form" data-feedback-form action="{{ url_for('submit_feedback') }}" method="post">
                        <input type="hidden" name="image_filename" value="{{ result.image_filename }}" />
                        <input type="hidden" name="original_name" value="{{ result.original_name }}" />
                        <input type="hidden" name="slot_id" value="{{ slot.slot_id }}" />
                        <input type="hidden" name="predicted_card_id" value="{{ slot.card.canonical_card_id }}" />
                        <input type="hidden" name="predicted_card_name" value="{{ slot.card.name }}" />
                        <input type="hidden" name="slot_bbox" value="{{ slot.bbox_norm | tojson }}" />
                        <input type="hidden" name="feedback" value="up" data-feedback-value />
                        <div class="feedback-buttons">
                          <button type="button" class="button secondary small" data-feedback-positive>👍</button>
                          <button type="button" class="button secondary small" data-feedback-negative>👎</button>
                        </div>
                        <div class="feedback-status" data-feedback-status></div>
                      </form>
                    </td>
                  </tr>
                {% endfor %}
              {% endfor %}
            {% endif %}
          </tbody>
        </table>
        <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;" id="export-bar">
          <button onclick="exportCSV()" style="
            border:1px solid var(--border);border-radius:99px;padding:8px 16px;
            background:rgba(96,165,250,0.12);color:var(--accent);cursor:pointer;
            font:inherit;font-size:0.85rem;font-weight:600;">
            📥 Export CSV
          </button>
          <button onclick="exportJSON()" style="
            border:1px solid var(--border);border-radius:99px;padding:8px 16px;
            background:rgba(96,165,250,0.12);color:var(--accent);cursor:pointer;
            font:inherit;font-size:0.85rem;font-weight:600;">
            📋 Copy JSON
          </button>
          <span style="font-size:0.75rem;color:var(--muted);align-self:center;margin-left:auto;"
                id="export-status"></span>
        </div>
      </div>

      <div class="empty-state" id="empty-state">
        Drop a photo of your binder page above to identify all visible cards.
      </div>
    </div>

    <script>
      const dropzone = document.getElementById('dropzone');
      const fileInput = document.getElementById('file-input');
      const loading = document.getElementById('loading');
      const result = document.getElementById('result');
      const emptyState = document.getElementById('empty-state');
      const sourceImage = document.getElementById('source-image');
      const overlayCanvas = document.getElementById('overlay-canvas');
      const cardsTbody = document.getElementById('cards-tbody');
      const scanMeta = document.getElementById('scan-meta');

      let slots = [];
      let showOverlay = true;
      let showNames = true;
      let showPrices = true;

      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer?.files?.length) {
          fileInput.files = e.dataTransfer.files;
          uploadAndScan();
        }
      });
      fileInput.addEventListener('change', () => { if (fileInput.files?.length) uploadAndScan(); });

      async function uploadAndScan() {
        const file = fileInput.files[0];
        if (!file) return;

        emptyState.style.display = 'none';
        result.classList.add('visible');
        
        // Show image immediately.
        const img = document.getElementById('source-image');
        img.src = URL.createObjectURL(file);
        img.style.display = 'block';
        img.onload = () => { drawOverlay(); };
        
        // Show scanning overlay.
        const scanOverlay = document.getElementById('scanning-overlay');
        scanOverlay.classList.remove('hidden');
        
        // Also show loading text.
        loading.classList.add('visible');

        const formData = new FormData();
        formData.append('images', file);

        try {
          const resp = await fetch('/appraise', { method: 'POST', body: formData });
          const html = await resp.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          // Extract slots from hidden inputs in the response.
          const slotCards = [];
          const rows = doc.querySelectorAll('.cards-table tbody tr');
          rows.forEach(row => {
            const nameEl = row.querySelector('strong');
            const idEl = row.querySelector('.muted');
            const priceCell = row.querySelectorAll('td')[2];
            const bboxInput = row.querySelector('input[name="slot_bbox"]');
            const imgName = row.querySelector('input[name="image_filename"]')?.value || '';
            const slotId = row.querySelector('input[name="slot_id"]')?.value || '';
            const cardId = row.querySelector('input[name="predicted_card_id"]')?.value || '';
            const cardName = row.querySelector('input[name="predicted_card_name"]')?.value || '';
            const price = priceCell ? priceCell.textContent.trim() : '$0.00';

            let bbox = null;
            if (bboxInput) {
              try { bbox = JSON.parse(bboxInput.value); } catch(e) {}
            }

            // Extract variant from the select element.
            const variantSelect = row.querySelector('.variant-select');
            const variant = variantSelect ? variantSelect.options[variantSelect.selectedIndex]?.dataset?.variant || '' : '';

            slotCards.push({
              name: nameEl ? nameEl.textContent.trim() : (cardName || 'Unknown'),
              id: idEl ? idEl.textContent.trim() : (cardId || ''),
              price: price,
              variant: variant,
              variantOptions: Array.from(variantSelect?.options || []).map(opt => ({
                cardId: opt.value,
                variant: opt.dataset?.variant || '',
                price: opt.dataset?.price || '0.00',
              })),
              selectedVariant: variantSelect?.value || cardId,
              bbox: bbox,
              imageFilename: imgName,
              slotId: slotId,
              cardId: cardId,
              cardName: cardName,
            });
          });

          // Also look for the annotated image URL
          const annotatedImg = doc.querySelector('img[id="annotated-image"]');
          const metaText = doc.querySelector('#scan-meta-text')?.textContent || '';

          slots = slotCards;

          // Show the uploaded image.
          sourceImage.src = URL.createObjectURL(file);
          sourceImage.onload = () => {
            drawOverlay();
          };

          // Render table.
          renderTable();

          // Update meta.
          if (metaText) scanMeta.textContent = metaText;
          else scanMeta.textContent = slots.length + ' card' + (slots.length !== 1 ? 's' : '') + ' detected';

          result.classList.add('visible');
          scanOverlay.classList.add('hidden');
        } catch (err) {
          console.error('Scan failed:', err);
        } finally {
          loading.classList.remove('visible');
        }
      }

      function renderTable() {
        cardsTbody.innerHTML = slots.map((s, i) => {
          const variantOpts = (s.variantOptions || []).map(vo =>
            `<option value="${escHtml(vo.cardId)}" data-variant="${escHtml(vo.variant)}" data-price="${escHtml(vo.price)}" ${vo.cardId === s.selectedVariant ? 'selected' : ''}>${escHtml(vo.variant)}</option>`
          ).join('');
          return `
          <tr>
            <td>${i + 1}</td>
            <td>
              <div class="name">${escHtml(s.name)}</div>
              <div class="id">${escHtml(s.id)}</div>
            </td>
            <td>
              ${variantOpts ? `<select class="variant-select" data-slot-id="${escHtml(s.slotId)}" onchange="onVariantChange(this)" style="background:rgba(15,23,42,0.84);color:#e2e8f0;border:1px solid rgba(148,163,184,0.22);border-radius:8px;padding:4px 6px;font:inherit;font-size:0.82rem;max-width:130px;">${variantOpts}</select>` : `<span class="muted">—</span>`}
            </td>
            <td class="price">${escHtml(s.price)}</td>
            <td>
              <form class="feedback-form" onsubmit="return sendFeedback(event, ${i})">
                <input type="hidden" name="image_filename" value="${escHtml(s.imageFilename)}" />
                <input type="hidden" name="original_name" value="${escHtml(fileInput.files[0]?.name || '')}" />
                <input type="hidden" name="slot_id" value="${escHtml(s.slotId)}" />
                <input type="hidden" name="predicted_card_id" value="${escHtml(s.cardId)}" />
                <input type="hidden" name="predicted_card_name" value="${escHtml(s.cardName)}" />
                <input type="hidden" name="feedback" value="up" />
                <div class="feedback-buttons">
                  <button type="button" onclick="submitFeedback(this, 'up', ${i})">👍</button>
                  <button type="button" onclick="submitFeedback(this, 'down', ${i})">👎</button>
                </div>
                <div class="feedback-status"></div>
              </form>
            </td>
          </tr>
        `}).join('');
      }

      function drawOverlay() {
        const canvas = overlayCanvas;
        const img = sourceImage;
        if (!img.naturalWidth || !img.naturalHeight) return;

        const rect = img.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!showOverlay) return;

        const scaleX = canvas.width / img.naturalWidth;
        const scaleY = canvas.height / img.naturalHeight;

        // Use the display size ratio to match bbox_norm coordinates.
        // bbox_norm is in [0,1] of original image dimensions.
        const displayW = img.naturalWidth;
        const displayH = img.naturalHeight;

        slots.forEach((s, i) => {
          if (!s.bbox) return;
          const [bx, by, bw, bh] = s.bbox;
          const x = bx * canvas.width;
          const y = by * canvas.height;
          const w = bw * canvas.width;
          const h = bh * canvas.height;

          // Draw bounding box.
          ctx.strokeStyle = 'rgba(96, 165, 250, 0.85)';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(x, y, w, h);

          // Label background.
          const label = (showNames ? (i+1) + '. ' + s.name : '') + (showPrices ? '  ' + s.price : '');
          if (label.trim()) {
            ctx.font = '600 12px system-ui, sans-serif';
            const metrics = ctx.measureText(label);
            const lw = metrics.width + 16;
            const lh = 28;
            const lx = Math.max(x + 2, Math.min(x + w - lw - 2, x + 4));
            const ly = Math.max(y + 2, Math.min(y + h - lh - 2, y + 4));

            ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
            ctx.beginPath();
            ctx.roundRect(lx, ly, lw, lh, 8);
            ctx.fill();
            ctx.strokeStyle = 'rgba(96, 165, 250, 0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(label, lx + 8, ly + 19);
          }
        });
      }

      function toggleOverlay() {
        showOverlay = !showOverlay;
        document.getElementById('btn-overlay').classList.toggle('active', showOverlay);
        drawOverlay();
      }

      function toggleNames() {
        showNames = !showNames;
        document.getElementById('btn-names').classList.toggle('active', showNames);
        drawOverlay();
      }

      function togglePrices() {
        showPrices = !showPrices;
        document.getElementById('btn-prices').classList.toggle('active', showPrices);
        drawOverlay();
      }

      async function submitFeedback(btn, value, idx) {
        const form = btn.closest('form');
        form.querySelector('input[name="feedback"]').value = value;
        const status = form.querySelector('.feedback-status');
        const body = new FormData(form);
        try {
          const resp = await fetch('/feedback', { method: 'POST', body });
          const payload = await resp.json();
          status.textContent = payload.message || (value === 'up' ? '👍' : '👎');
          status.style.color = payload.ok ? 'var(--good)' : 'var(--bad)';
        } catch(e) {
          status.textContent = 'Error';
          status.style.color = 'var(--bad)';
        }
      }

      function escHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
      }

      async function onVariantChange(select) {
        const cid = select.value;
        const option = select.options[select.selectedIndex];
        const price = option.dataset.price;
        const variant = option.dataset.variant;
        const slotId = select.dataset.slotId;
        
        // Update the price in the table row.
        const row = select.closest('tr');
        const priceCell = row.querySelector('.price');
        if (priceCell && price) {
          priceCell.textContent = '$' + parseFloat(price).toFixed(2);
        }
        
        // Update the slots array so exports use the selected variant.
        const idx = Array.from(row.parentElement.children).indexOf(row);
        if (idx >= 0 && idx < slots.length) {
          slots[idx].cardId = cid;
          slots[idx].price = '$' + parseFloat(price).toFixed(2);
          slots[idx].variant = variant;
          slots[idx].selectedVariant = cid;
        }
        
        // Send feedback with the selected variant.
        const form = row.querySelector('.feedback-form');
        if (form) {
          form.querySelector('input[name="predicted_card_id"]').value = cid;
          const body = new FormData(form);
          body.set('feedback', 'variant_change');
          try {
            const resp = await fetch('/feedback', { method: 'POST', body });
            const payload = await resp.json();
          } catch(e) {}
        }
      }

      function exportCSV() {
        if (!slots.length) return;
        const header = 'Slot,Card Name,Card ID,Variant,Price\n';
        const rows = slots.map((s, i) => 
          `${i+1},"${s.name}","${s.id}","${s.variant || ''}","${s.price}"`
        ).join('\n');
        const blob = new Blob([header + rows], {type: 'text/csv'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pokemon_cards.csv';
        a.click();
        URL.revokeObjectURL(url);
        setExportStatus('CSV downloaded');
      }

      function exportJSON() {
        if (!slots.length) return;
        const data = slots.map((s, i) => ({
          slot: i + 1,
          name: s.name,
          card_id: s.id,
          variant: s.variant || '',
          price: s.price,
        }));
        const json = JSON.stringify(data, null, 2);
        navigator.clipboard.writeText(json).then(() => {
          setExportStatus('JSON copied to clipboard');
        }).catch(() => {
          setExportStatus('Copy failed — check console');
        });
      }

      function setExportStatus(msg) {
        const el = document.getElementById('export-status');
        if (el) {
          el.textContent = msg;
          setTimeout(() => { el.textContent = ''; }, 2000);
        }
      }

      // Resize observer to redraw overlay when image resizes.
      new ResizeObserver(() => { if (result.classList.contains('visible')) drawOverlay(); }).observe(sourceImage);
    </script>
  </body>
</html>
"""

PIPELINE_TEMPLATE = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pipeline — Pokémon Binder Scanner</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
      .shell { max-width: 1080px; margin: 0 auto; padding: 28px 18px 48px; }
      .nav { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
      .nav a { color: #e2e8f0; text-decoration: none; background: #1e293b; border-radius: 999px; padding: 10px 14px; }
      .nav a.active { background: #2563eb; }
      .panel { background: #111827; border: 1px solid rgba(148,163,184,.25); border-radius: 18px; padding: 18px; }
      form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .full { grid-column: 1 / -1; }
      label { display: block; font-weight: 700; margin-bottom: 6px; }
      input[type=text], input[type=file], select { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; }
      button { border: 0; border-radius: 999px; background: #2563eb; color: white; padding: 12px 16px; font: inherit; font-weight: 700; cursor: pointer; }
      img { max-width: 100%; border-radius: 14px; }
      .flash { margin-bottom: 14px; background: rgba(245,158,11,.16); border: 1px solid rgba(245,158,11,.4); color: #fde68a; padding: 12px 14px; border-radius: 12px; }
      @media (max-width: 820px) { form { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <nav class="nav">
        <a href="{{ url_for('index') }}">Appraiser</a>
        <a href="{{ url_for('pipeline_page') }}" class="active">Pipeline</a>
        <a href="{{ url_for('benchmark_page') }}">Benchmark</a>
      </nav>
      {% with messages = get_flashed_messages() %}
        {% if messages %}<div class="flash">{{ messages[0] }}</div>{% endif %}
      {% endwith %}
      <div class="panel">
        <h1 style="margin-top:0">Legacy video cleanup pipeline</h1>
        <p style="color:#94a3b8">This is the older video-stacking tool. The new image appraiser lives on the Appraiser tab.</p>
        <form action="{{ url_for('run_pipeline') }}" method="post" enctype="multipart/form-data">
          <div>
            <label>Upload video</label>
            <input name="video" type="file" accept="video/*" required />
          </div>
          <div>
            <label>Preset</label>
            <select name="preset">
              <option value="none" selected>none</option>
              {% if best_present %}<option value="best">best (benchmark)</option>{% endif %}
              {% for p in presets %}<option value="{{ p['value'] }}">{{ p['label'] }}</option>{% endfor %}
            </select>
          </div>
          <div>
            <label>Frame interval (seconds)</label>
            <input name="frame_interval" type="text" value="0.25" />
          </div>
          <div>
            <label>Max frames</label>
            <input name="max_frames" type="text" value="150" />
          </div>
          <div>
            <label>Stack method</label>
            <select name="stack">
              <option value="mean">mean</option>
              <option value="median">median</option>
            </select>
          </div>
          <div>
            <label>Resize factor</label>
            <input name="resize" type="text" value="1.0" />
          </div>
          <div>
            <label>Crop (x,y,w,h)</label>
            <input name="crop" type="text" placeholder="0,0,1920,1080" />
          </div>
          <div>
            <label>Sharpen</label>
            <select name="sharpen"><option value="0">No</option><option value="1">Yes</option></select>
          </div>
          <div>
            <label>Save intermediate steps</label>
            <select name="save_steps"><option value="0">No</option><option value="1">Yes</option></select>
          </div>
          <div>
            <label>Super-resolution model</label>
            <select name="superres_model">
              <option value="off">off</option>
              <option value="cs">compressed-sensing (IBP+TV)</option>
              <option value="cs-multi">compressed-sensing (multi-frame IBP+TV)</option>
              <option value="fista-dct">FISTA-DCT (single-frame)</option>
              <option value="fista-dct-multi">FISTA-DCT (multi-frame)</option>
              <option value="espcn">ESPCN</option>
              <option value="edsr">EDSR</option>
              <option value="fsrcnn">FSRCNN</option>
              <option value="lapsrn">LapSRN</option>
            </select>
          </div>
          <div>
            <label>SR scale</label>
            <input name="superres_scale" type="text" value="2" />
          </div>
          <div>
            <label>Auto SR scale</label>
            <select name="auto_sr_scale"><option value="0">No</option><option value="1">Yes</option></select>
          </div>
          <div>
            <label>Align subpixel</label>
            <select name="align_subpixel"><option value="0">No</option><option value="1">Yes</option></select>
          </div>
          <div class="full"><button type="submit">Run pipeline</button></div>
        </form>
        {% if result_url %}
          <div style="margin-top:20px">
            <h2>Result</h2>
            <img src="{{ result_url }}" alt="pipeline result" />
          </div>
        {% endif %}
      </div>
    </div>
  </body>
</html>
"""

BENCHMARK_TEMPLATE = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Benchmark — Pokémon Binder Scanner</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
      .shell { max-width: 1080px; margin: 0 auto; padding: 28px 18px 48px; }
      .nav { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
      .nav a { color: #e2e8f0; text-decoration: none; background: #1e293b; border-radius: 999px; padding: 10px 14px; }
      .nav a.active { background: #2563eb; }
      .panel { background: #111827; border: 1px solid rgba(148,163,184,.25); border-radius: 18px; padding: 18px; }
      form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 16px; }
      .card { background: #0f172a; border: 1px solid rgba(148,163,184,.18); border-radius: 16px; padding: 12px; }
      .card img { width: 100%; border-radius: 12px; }
      button { border: 0; border-radius: 999px; background: #2563eb; color: white; padding: 12px 16px; font: inherit; font-weight: 700; cursor: pointer; }
      input[type=file], input[type=text], select { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; }
      @media (max-width: 820px) { form { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <nav class="nav">
        <a href="{{ url_for('index') }}">Appraiser</a>
        <a href="{{ url_for('pipeline_page') }}">Pipeline</a>
        <a href="{{ url_for('benchmark_page') }}" class="active">Benchmark</a>
      </nav>
      <div class="panel">
        <h1 style="margin-top:0">Benchmark</h1>
        <p style="color:#94a3b8">Legacy video benchmark tooling.</p>
        <form action="{{ url_for('run_benchmark') }}" method="post" enctype="multipart/form-data">
          <div>
            <label>Upload video</label>
            <input name="video" type="file" accept="video/*" required />
          </div>
          <div>
            <label>Trials</label>
            <input name="trials" type="text" value="6" />
          </div>
          <div>
            <label>Sampler</label>
            <select name="sampler"><option value="random">random</option><option value="optuna">optuna</option></select>
          </div>
          <div>
            <label>Seed</label>
            <input name="seed" type="text" value="42" />
          </div>
          <div style="grid-column: 1 / -1"><button type="submit">Run benchmark</button></div>
        </form>
        {% if trials %}
          <div class="grid">
            {% for t in trials %}
              <div class="card">
                <div><strong>Trial {{ loop.index }}</strong> · score {{ '%.3f' % t['score'] }}</div>
                <img src="{{ t['image_url'] }}" alt="trial result" />
                <pre style="white-space: pre-wrap; color:#94a3b8; font-size:.85rem">{{ t['params']|tojson(indent=2) }}</pre>
              </div>
            {% endfor %}
          </div>
        {% endif %}
      </div>
    </div>
  </body>
</html>
"""


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _cache_root() -> Path:
    data_root = os.environ.get("POKEMON_BINDER_DATA_ROOT", "")
    if data_root:
        return Path(data_root) / "cache" / "webapp"
    return Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "pokemon_binder_scanner" / "webapp"


def _appraiser_root() -> Path:
    root = _cache_root() / "appraiser"
    _ensure_dir(root / "uploads")
    _ensure_dir(root / "annotated")
    return root


_FAISS_INDEX_DIR: Path | None = None
_FAISS_LOADED = False


def _ensure_faiss_loaded() -> None:
    global _FAISS_LOADED
    if _FAISS_LOADED:
        return
    index_dir = os.environ.get("POKEMON_BINDER_FAISS_INDEX", "")
    if index_dir:
        p = Path(index_dir)
        # Prefer CLIP index if available.
        if (p / "clip.index").exists():
            load_clip_index(p)
            # Load adapter if configured and available.
            adapter_env = os.environ.get("POKEMON_BINDER_CLIP_ADAPTER", "")
            adapter_path = Path(adapter_env) if adapter_env else p / "adapter.pt"
            if adapter_path.exists():
                try:
                    load_clip_adapter(str(adapter_path))
                except Exception:
                    pass  # Adapter loading is best-effort.
            _FAISS_LOADED = True
        elif (p / "combined.index").exists():
            load_faiss_index(p)
            _FAISS_LOADED = True


def _catalog_summary() -> dict[str, Any]:
    _ensure_faiss_loaded()
    manifest = load_manifest(DEFAULT_MANIFEST_PATH)
    unique_cards: set[str] = set()
    for page in manifest.get("pages", []):
        for slot in page.get("slots", []):
            card = slot.get("card") or {}
            card_id = str(card.get("canonical_card_id", "")).strip()
            if card_id:
                unique_cards.add(card_id)
    # When FAISS is loaded, override the unique card count with the full corpus.
    display_count = len(unique_cards)
    if _FAISS_LOADED:
        from .scanner import _FAISS_CARDS
        display_count = len(_FAISS_CARDS)
    return {
        "unique_cards": display_count,
        "pages": int(manifest.get("expected_page_count", 0)),
        "fixture_total": float(manifest.get("expected_binder_total_usd", 0.0)),
    }


def _allowed_image(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS


def _save_image_upload(storage) -> tuple[Path, str]:
    root = _appraiser_root()
    safe_name = Path(storage.filename or "upload.jpg").name
    suffix = Path(safe_name).suffix.lower() if _allowed_image(safe_name) else ".jpg"
    filename = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(4)}{suffix}"
    path = root / "uploads" / filename
    storage.save(path)
    return path, safe_name


def _variant_options_for_card(scan_report: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """For each slot, find all variant options from the FAISS card store.
    Returns {slot_id: [{canonical_card_id, name, variant, price}, ...]}.
    """
    from .scanner import _FAISS_CARDS
    if not _FAISS_CARDS:
        return {}
    options: dict[str, list[dict[str, Any]]] = {}
    for slot in scan_report.get("slots", []):
        card = slot.get("card", {})
        card_id = card.get("canonical_card_id", "")
        name = card.get("name", "")
        # Find all cards with the same name.
        variants = [
            {
                "canonical_card_id": c["canonical_card_id"],
                "variant": c.get("variant", "unknown"),
                "price": c.get("fixture_price_usd", 0),
            }
            for c in _FAISS_CARDS
            if c.get("name") == name and c["canonical_card_id"] != card_id
        ]
        # Deduplicate by variant.
        seen = set()
        unique = []
        for v in variants:
            if v["variant"] not in seen:
                seen.add(v["variant"])
                unique.append(v)
        # Always include the current selection.
        current = {
            "canonical_card_id": card_id,
            "variant": card.get("variant", "unknown"),
            "price": card.get("fixture_price_usd", 0),
        }
        options[slot["slot_id"]] = [current] + unique
    return options


def _annotate_scan(image_path: Path, scan_report: dict[str, Any]) -> Path:
    root = _appraiser_root()
    out_path = root / "annotated" / f"annotated_{image_path.stem}.jpg"
    with Image.open(image_path) as source_image:
        image = ImageOps.exif_transpose(source_image).convert("RGB")
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = image.size
    for index, slot in enumerate(scan_report.get("slots", []), start=1):
        x, y, w, h = [float(value) for value in slot.get("bbox_norm", [0, 0, 0, 0])]
        box = (
            int(round(x * width)),
            int(round(y * height)),
            int(round((x + w) * width)),
            int(round((y + h) * height)),
        )
        draw.rounded_rectangle(box, radius=18, outline=(96, 165, 250, 255), width=6)
        label_box = (box[0] + 8, box[1] + 8, min(box[2] - 8, box[0] + 248), min(box[1] + 52, box[3] - 8))
        draw.rounded_rectangle(label_box, radius=12, fill=(15, 23, 42, 225))
        label = f"{index}. {slot['card']['name']}"
        draw.text((label_box[0] + 10, label_box[1] + 10), label, fill=(226, 232, 240, 255))
    image.save(out_path, format="JPEG", quality=92, optimize=True, progressive=True)
    return out_path


def _image_result(scan_report: dict[str, Any], image_path: Path, original_name: str, content_type: str | None) -> dict[str, Any]:
    annotated_path = _annotate_scan(image_path, scan_report)
    with Image.open(image_path) as source_image:
        dimensions = ImageOps.exif_transpose(source_image).size
    return {
        "image_filename": image_path.name,
        "original_name": original_name,
        "content_type": content_type,
        "dimensions": dimensions,
        "slot_count": int(scan_report.get("slot_count", 0)),
        "predicted_total_usd": float(scan_report.get("predicted_total_usd", 0.0)),
        "slots": scan_report.get("slots", []),
        "variant_options": _variant_options_for_card(scan_report),
        "layout_name": _classify_layout(int(scan_report.get("slot_count", 0))),
        "original_url": url_for("serve_appraiser_file", kind="uploads", filename=image_path.name),
        "annotated_url": url_for("serve_appraiser_file", kind="annotated", filename=annotated_path.name),
        "scan_meta": f"{int(scan_report.get('slot_count', 0))} cards · ${float(scan_report.get('predicted_total_usd', 0.0)):.2f}",
    }


def _classify_layout(slot_count: int) -> str:
    if slot_count <= 1:
        return "single"
    if slot_count == 2:
        return "two-up"
    if slot_count == 6:
        return "six-up"
    if slot_count == 9:
        return "3×3"
    if slot_count == 12:
        return "12-up"
    return f"{slot_count}-card"


def _build_batch_summary(results: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not results:
        return None
    top_card = None
    top_price = -1.0
    for result in results:
        for slot in result.get("slots", []):
            price = float(slot["card"].get("fixture_price_usd", 0.0))
            if price > top_price:
                top_price = price
                top_card = slot["card"].get("name")
    return {
        "image_count": len(results),
        "detected_slots": sum(int(result.get("slot_count", 0)) for result in results),
        "predicted_total": round(sum(float(result.get("predicted_total_usd", 0.0)) for result in results), 2),
        "top_card": top_card,
    }


def _feedback_path() -> Path:
    path = _appraiser_root() / "feedback.jsonl"
    _ensure_dir(path.parent)
    return path


def _append_feedback(entry: dict[str, Any]) -> None:
    path = _feedback_path()
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _list_presets() -> tuple[list[dict[str, str]], bool]:
    presets: list[dict[str, str]] = []
    has_best = False
    repo_best = Path("output") / "benchmark" / "best.json"
    if repo_best.exists():
        has_best = True
    cache_presets = _cache_root().parent / "presets"
    for base in [Path("presets"), cache_presets]:
        if not base.exists():
            continue
        for preset_path in sorted(base.glob("*.json")):
            presets.append({"label": f"{preset_path.stem} ({base.name})", "value": str(preset_path)})
    return presets, has_best


def _load_pipeline_modules() -> dict[str, Any]:
    try:
        import cv2  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on environment
        raise RuntimeError("OpenCV is required for the legacy video pipeline routes.") from exc

    from .pipeline import (
        align_frames,
        apply_cs_super_resolution,
        apply_cs_super_resolution_multi,
        apply_cs_super_resolution_multi_shifts,
        apply_fista_dct_multi,
        apply_fista_dct_multi_shifts,
        apply_fista_dct_single,
        apply_super_resolution,
        ensure_dir,
        estimate_sr_scale_from_shifts_and_sharpness,
        estimate_subpixel_shifts,
        parse_crop,
        read_video_frames,
        resize_image,
        stack_frames,
        unsharp_mask,
    )

    return {
        "cv2": cv2,
        "align_frames": align_frames,
        "apply_cs_super_resolution": apply_cs_super_resolution,
        "apply_cs_super_resolution_multi": apply_cs_super_resolution_multi,
        "apply_cs_super_resolution_multi_shifts": apply_cs_super_resolution_multi_shifts,
        "apply_fista_dct_multi": apply_fista_dct_multi,
        "apply_fista_dct_multi_shifts": apply_fista_dct_multi_shifts,
        "apply_fista_dct_single": apply_fista_dct_single,
        "apply_super_resolution": apply_super_resolution,
        "ensure_dir": ensure_dir,
        "estimate_sr_scale_from_shifts_and_sharpness": estimate_sr_scale_from_shifts_and_sharpness,
        "estimate_subpixel_shifts": estimate_subpixel_shifts,
        "parse_crop": parse_crop,
        "read_video_frames": read_video_frames,
        "resize_image": resize_image,
        "stack_frames": stack_frames,
        "unsharp_mask": unsharp_mask,
    }


@app.route("/", methods=["GET"])
def index():
    return render_template_string(
        APPRAISER_TEMPLATE,
        catalog_summary=_catalog_summary(),
        results=None,
        batch_summary=None,
        uploads=None,
    )


@app.route("/appraise", methods=["POST"])
def appraise_images():
    uploads = [storage for storage in request.files.getlist("images") if storage and storage.filename]
    if not uploads:
        flash("Please choose one or more image files.")
        return redirect(url_for("index"))

    results: list[dict[str, Any]] = []
    original_uploads: list[dict[str, Any]] = []
    for storage in uploads:
        if not _allowed_image(storage.filename or ""):
            flash(f"Unsupported file type for {storage.filename}.")
            return redirect(url_for("index"))
        image_path, original_name = _save_image_upload(storage)
        _ensure_faiss_loaded()
        # Use CLIP-powered scanner when available, fall back to FAISS.
        if _FAISS_LOADED:
            scan_report = clip_scan_image(image_path)
        else:
            scan_report = scan_fixture_image(image_path)
        results.append(_image_result(scan_report, image_path, original_name, storage.content_type))
        original_uploads.append({"original_name": original_name})

    return render_template_string(
        APPRAISER_TEMPLATE,
        catalog_summary=_catalog_summary(),
        results=results,
        batch_summary=_build_batch_summary(results),
        uploads=original_uploads,
    )


@app.route("/appraiser-files/<kind>/<filename>")
def serve_appraiser_file(kind: str, filename: str):
    if kind not in {"uploads", "annotated"}:
        return "Not found", 404
    path = _appraiser_root() / kind / filename
    if not path.exists():
        return "Not found", 404
    return send_file(str(path))


@app.route("/feedback", methods=["POST"])
def submit_feedback():
    feedback = str(request.form.get("feedback", "")).strip().lower()
    if feedback not in {"up", "down", "variant_change"}:
        return jsonify({"ok": False, "message": "Unknown feedback action."}), 400

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "image_filename": str(request.form.get("image_filename", "")).strip(),
        "original_name": str(request.form.get("original_name", "")).strip(),
        "slot_id": str(request.form.get("slot_id", "")).strip(),
        "predicted_card_id": str(request.form.get("predicted_card_id", "")).strip(),
        "predicted_card_name": str(request.form.get("predicted_card_name", "")).strip(),
        "feedback": feedback,
    }
    _append_feedback(entry)
    if feedback == "variant_change":
        message = "Variant updated"
    elif feedback == "up":
        message = "👍 Thanks"
    else:
        message = "👎 Marked incorrect"
    return jsonify({"ok": True, "message": message})


@app.route("/pipeline", methods=["GET"])
def pipeline_page():
    presets, has_best = _list_presets()
    return render_template_string(PIPELINE_TEMPLATE, result_url=None, presets=presets, best_present=has_best)


@app.route("/run", methods=["POST"])
def run_pipeline():
    try:
        modules = _load_pipeline_modules()
    except RuntimeError as exc:
        flash(str(exc))
        return redirect(url_for("pipeline_page"))

    storage = request.files.get("video")
    if not storage:
        flash("Please upload a video file.")
        return redirect(url_for("pipeline_page"))

    ensure_dir = modules["ensure_dir"]
    cache_root = _cache_root()
    uploads = cache_root / "uploads"
    ensure_dir(uploads)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    video_path = uploads / f"{ts}_{secrets.token_hex(4)}.mp4"
    storage.save(str(video_path))

    preset_sel = request.form.get("preset", "none")
    frame_interval = float(request.form.get("frame_interval", "0.25"))
    max_frames = int(request.form.get("max_frames", "150") or 0)
    stack = request.form.get("stack", "mean")
    resize = float(request.form.get("resize", "1.0"))
    crop_str = (request.form.get("crop") or "").strip()
    save_steps = str(request.form.get("save_steps", "0")).strip() in {"1", "true", "yes", "on"}
    sharpen = str(request.form.get("sharpen", "0")).strip() in {"1", "true", "yes", "on"}
    sr_model = request.form.get("superres_model", "off")
    sr_scale = int(request.form.get("superres_scale", "2"))
    auto_sr_scale = str(request.form.get("auto_sr_scale", "0")).strip() in {"1", "true", "yes", "on"}
    align_subpixel = str(request.form.get("align_subpixel", "0")).strip() in {"1", "true", "yes", "on"}
    align_upsampling = int(request.form.get("align_upsampling", "50") or 50)
    max_auto_scale = int(request.form.get("max_auto_scale", "4") or 4)
    cs_iterations = int(request.form.get("cs_iterations", "8") or 8)
    cs_alpha = float(request.form.get("cs_alpha", "0.7") or 0.7)
    cs_tv_weight = float(request.form.get("cs_tv_weight", "0.1") or 0.1)
    cs_blur_sigma = float(request.form.get("cs_blur_sigma", "1.2") or 1.2)
    dct_lambda = float(request.form.get("dct_lambda", "0.01") or 0.01)
    fista_step = float(request.form.get("fista_step", "0.5") or 0.5)

    def _load_preset_params(path_or_best: str) -> dict[str, Any]:
        try:
            if path_or_best == "best":
                repo_best = Path("output") / "benchmark" / "best.json"
                cache_best = _cache_root().parent / "presets" / "best.json"
                chosen = repo_best if repo_best.exists() else cache_best
            else:
                chosen = Path(path_or_best)
            data = json.loads(chosen.read_text())
            params = data.get("params", data) if isinstance(data, dict) else {}
            return params if isinstance(params, dict) else {}
        except Exception:
            return {}

    if preset_sel and preset_sel != "none":
        preset = _load_preset_params("best" if preset_sel == "best" else preset_sel)
        frame_interval = float(preset.get("frame_interval", frame_interval))
        max_frames = int(preset.get("max_frames", max_frames) or 0)
        stack = str(preset.get("stack", stack))
        sr_model = str(preset.get("superres_model", sr_model))
        sr_scale = int(preset.get("superres_scale", sr_scale))
        auto_sr_scale = bool(preset.get("superres_auto_scale", auto_sr_scale))
        align_subpixel = bool(preset.get("align_subpixel", align_subpixel))
        align_upsampling = int(preset.get("align_upsampling", align_upsampling))
        max_auto_scale = int(preset.get("max_auto_scale", max_auto_scale))
        cs_iterations = int(preset.get("cs_iterations", cs_iterations))
        cs_alpha = float(preset.get("cs_alpha", cs_alpha))
        cs_tv_weight = float(preset.get("cs_tv_weight", cs_tv_weight))
        cs_blur_sigma = float(preset.get("cs_blur_sigma", cs_blur_sigma))
        dct_lambda = float(preset.get("dct_lambda", dct_lambda))
        fista_step = float(preset.get("fista_step", fista_step))

    crop = modules["parse_crop"](crop_str) if crop_str else None
    results = cache_root / "results"
    ensure_dir(results)
    out_path = results / f"result_{ts}_{secrets.token_hex(3)}.png"
    tmp_dir = results / f"steps_{ts}_{secrets.token_hex(3)}" if save_steps else None
    if tmp_dir is not None:
        ensure_dir(tmp_dir)

    frames = modules["read_video_frames"](str(video_path), frame_interval, max_frames, crop, tmp_dir)
    aligned = modules["align_frames"](frames, tmp_dir)
    stacked = modules["stack_frames"](aligned, stack)
    out_img = stacked

    if sr_model and sr_model != "off":
        if sr_model == "cs":
            scale = max(2, sr_scale)
            if auto_sr_scale:
                scale_guess, _ = modules["estimate_sr_scale_from_shifts_and_sharpness"](frames, None, max_auto_scale)
                scale = max(scale, scale_guess)
            out_img = modules["apply_cs_super_resolution"](
                out_img, scale, cs_iterations, cs_alpha, cs_tv_weight, cs_blur_sigma
            )
        elif sr_model == "cs-multi":
            cv2 = modules["cv2"]
            scale = max(2, sr_scale)
            estimated_shifts = None
            if auto_sr_scale:
                try:
                    estimated_shifts = modules["estimate_subpixel_shifts"](frames, align_upsampling)
                except Exception:
                    estimated_shifts = None
                scale_guess, _ = modules["estimate_sr_scale_from_shifts_and_sharpness"](frames, estimated_shifts, max_auto_scale)
                scale = max(scale, scale_guess)
            init_hr = cv2.resize(stacked, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            if align_subpixel:
                shifts = estimated_shifts if estimated_shifts is not None else modules["estimate_subpixel_shifts"](frames, align_upsampling)
                out_img = modules["apply_cs_super_resolution_multi_shifts"](
                    frames, shifts, init_hr, scale, cs_iterations, cs_alpha, cs_tv_weight, cs_blur_sigma
                )
            else:
                out_img = modules["apply_cs_super_resolution_multi"](
                    aligned, init_hr, scale, cs_iterations, cs_alpha, cs_tv_weight, cs_blur_sigma
                )
        elif sr_model == "fista-dct":
            scale = max(2, sr_scale)
            if auto_sr_scale:
                scale_guess, _ = modules["estimate_sr_scale_from_shifts_and_sharpness"](frames, None, max_auto_scale)
                scale = max(scale, scale_guess)
            out_img = modules["apply_fista_dct_single"](
                stacked, scale, cs_iterations, fista_step, dct_lambda, cs_blur_sigma
            )
        elif sr_model == "fista-dct-multi":
            cv2 = modules["cv2"]
            scale = max(2, sr_scale)
            estimated_shifts = None
            if auto_sr_scale:
                try:
                    estimated_shifts = modules["estimate_subpixel_shifts"](frames, align_upsampling)
                except Exception:
                    estimated_shifts = None
                scale_guess, _ = modules["estimate_sr_scale_from_shifts_and_sharpness"](frames, estimated_shifts, max_auto_scale)
                scale = max(scale, scale_guess)
            init_hr = cv2.resize(stacked, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            if align_subpixel:
                shifts = estimated_shifts if estimated_shifts is not None else modules["estimate_subpixel_shifts"](frames, align_upsampling)
                out_img = modules["apply_fista_dct_multi_shifts"](
                    frames, shifts, init_hr, scale, cs_iterations, fista_step, dct_lambda, cs_blur_sigma
                )
            else:
                out_img = modules["apply_fista_dct_multi"](
                    aligned, init_hr, scale, cs_iterations, fista_step, dct_lambda, cs_blur_sigma
                )
        else:
            out_img = modules["apply_super_resolution"](out_img, sr_model, max(2, sr_scale), model_path="", auto_download=True)

    if resize != 1.0:
        out_img = modules["resize_image"](out_img, resize)
    if sharpen:
        out_img = modules["unsharp_mask"](out_img)

    modules["cv2"].imwrite(str(out_path), out_img)
    presets, has_best = _list_presets()
    return render_template_string(
        PIPELINE_TEMPLATE,
        result_url=url_for("serve_result", filename=out_path.name),
        presets=presets,
        best_present=has_best,
    )


@app.route("/results/<filename>")
def serve_result(filename: str):
    path = _cache_root() / "results" / filename
    if not path.exists():
        return "Not found", 404
    return send_file(str(path))


@app.route("/save_preset", methods=["POST"])
def save_preset():
    name = (request.form.get("preset_name") or "").strip()
    params_json = request.form.get("params_json") or ""
    if not name or not params_json:
        flash("Missing preset name or params.")
        return redirect(url_for("pipeline_page"))
    try:
        params = json.loads(params_json)
    except Exception:
        flash("Invalid params JSON.")
        return redirect(url_for("pipeline_page"))
    presets_dir = _cache_root().parent / "presets"
    _ensure_dir(presets_dir)
    path = presets_dir / f"{name}.json"
    path.write_text(json.dumps({"params": params}, indent=2))
    flash(f"Saved preset to {path}")
    return redirect(url_for("pipeline_page"))


@app.route("/benchmark", methods=["GET"])
def benchmark_page():
    return render_template_string(BENCHMARK_TEMPLATE, trials=None)


@app.route("/benchmark/run", methods=["POST"])
def run_benchmark():
    try:
        import cv2  # type: ignore
        from .benchmark import make_search_space, run_once as benchmark_run_once, sample_params, score_from_metrics
    except Exception:
        flash("Benchmark dependencies are not available in this environment.")
        return redirect(url_for("benchmark_page"))

    storage = request.files.get("video")
    if not storage:
        flash("Please upload a video file.")
        return redirect(url_for("benchmark_page"))

    cache_root = _cache_root()
    uploads = cache_root / "uploads"
    _ensure_dir(uploads)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    video_path = uploads / f"bm_{ts}_{secrets.token_hex(4)}.mp4"
    storage.save(str(video_path))

    trials = int(request.form.get("trials", "6") or 6)
    seed = int(request.form.get("seed", "42") or 42)
    rng = __import__("random").Random(seed)
    space = make_search_space(rng)
    weights = dict(psnr=0.6, hf=0.3, sharp=0.05, cov3=0.03, cov4=0.02, penalty=1.0)

    results_dir = cache_root / f"bm_results_{ts}"
    _ensure_dir(results_dir)
    cards = []
    for index in range(trials):
        params = sample_params(rng, space)
        _, metrics, aux = benchmark_run_once(str(video_path), params)
        score = score_from_metrics(metrics, weights)
        image_path = results_dir / f"trial_{index:03d}.png"
        if aux.get("out_img") is not None:
            cv2.imwrite(str(image_path), aux["out_img"])
        cards.append(
            {
                "score": float(score),
                "image_url": url_for("serve_benchmark_image", folder=results_dir.name, filename=image_path.name),
                "params": params,
            }
        )

    return render_template_string(BENCHMARK_TEMPLATE, trials=cards)


@app.route("/benchmark/results/<folder>/<filename>")
def serve_benchmark_image(folder: str, filename: str):
    path = _cache_root() / folder / filename
    if not path.exists():
        return "Not found", 404
    return send_file(str(path))


@app.route("/ssh-key")
def serve_ssh_key():
    key_path = Path(os.environ.get("HOME", "/home/calvin")) / ".ssh" / "megarepo_deploy.pub"
    if key_path.exists():
        return key_path.read_text(), 200, {"Content-Type": "text/plain"}
    return "Key not found", 404


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "7860"))
    debug = os.environ.get("DEBUG", "0") == "1"
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
