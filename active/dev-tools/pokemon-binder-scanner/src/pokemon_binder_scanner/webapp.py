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
from .scanner import scan_fixture_image, faiss_scan_image, load_faiss_index, load_clip_index, clip_scan_image

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(16))

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

APPRAISER_TEMPLATE = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pokémon Binder Scanner</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07111f;
        --panel: rgba(15, 23, 42, 0.92);
        --panel-2: rgba(30, 41, 59, 0.92);
        --border: rgba(148, 163, 184, 0.28);
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #60a5fa;
        --accent-2: #22c55e;
        --danger: #f59e0b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(96, 165, 250, 0.16), transparent 32%),
          linear-gradient(180deg, #081120 0%, #050b15 100%);
        color: var(--text);
      }
      a { color: var(--accent); }
      .shell { max-width: 1240px; margin: 0 auto; padding: 32px 20px 56px; }
      .nav {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 22px;
      }
      .nav a {
        text-decoration: none;
        color: var(--text);
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 10px 14px;
      }
      .nav a.active {
        background: rgba(96, 165, 250, 0.18);
        border-color: rgba(96, 165, 250, 0.45);
      }
      .hero {
        display: grid;
        grid-template-columns: 1.4fr 0.9fr;
        gap: 18px;
        margin-bottom: 22px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 22px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
      }
      .hero h1 { margin: 0 0 10px; font-size: clamp(2rem, 4vw, 3.2rem); line-height: 1.05; }
      .hero p { margin: 0; color: var(--muted); max-width: 58ch; }
      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .stat {
        padding: 14px;
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 16px;
      }
      .stat .label { font-size: 0.82rem; color: var(--muted); margin-bottom: 6px; }
      .stat .value { font-size: 1.45rem; font-weight: 700; }
      .flash {
        margin-bottom: 18px;
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid rgba(245, 158, 11, 0.36);
        color: #fde68a;
        border-radius: 14px;
        padding: 14px 16px;
      }
      .upload-panel {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 18px;
        align-items: start;
        margin-bottom: 22px;
      }
      .dropzone {
        border: 2px dashed rgba(96, 165, 250, 0.45);
        border-radius: 20px;
        padding: 26px;
        text-align: center;
        background: linear-gradient(180deg, rgba(96, 165, 250, 0.10), rgba(96, 165, 250, 0.04));
        transition: 160ms ease;
      }
      .dropzone.dragover {
        border-color: rgba(34, 197, 94, 0.72);
        background: linear-gradient(180deg, rgba(34, 197, 94, 0.18), rgba(34, 197, 94, 0.07));
        transform: translateY(-1px);
      }
      .dropzone h2 { margin: 0 0 10px; font-size: 1.35rem; }
      .dropzone p { color: var(--muted); margin: 0 auto 16px; max-width: 42ch; }
      .upload-actions {
        display: flex;
        justify-content: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .button, button {
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: white;
        padding: 12px 18px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        text-decoration: none;
      }
      .button.small, button.small {
        padding: 9px 12px;
        font-size: 0.9rem;
      }
      .button.secondary {
        background: rgba(30, 41, 59, 0.88);
        border: 1px solid var(--border);
        color: var(--text);
      }
      input[type=file] { display: none; }
      .selected-files {
        margin-top: 16px;
        display: grid;
        gap: 8px;
      }
      .selected-files .file {
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.76);
        border: 1px solid rgba(148, 163, 184, 0.15);
        color: var(--muted);
      }
      .help-list { margin: 0; padding-left: 18px; color: var(--muted); }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 22px;
      }
      .result-card {
        margin-bottom: 18px;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        overflow: hidden;
      }
      .result-head {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        padding: 18px 20px;
        background: rgba(15, 23, 42, 0.88);
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      }
      .result-head h3 { margin: 0 0 6px; font-size: 1.15rem; }
      .result-head p { margin: 0; color: var(--muted); }
      .pill-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .pill {
        background: rgba(96, 165, 250, 0.15);
        border: 1px solid rgba(96, 165, 250, 0.28);
        color: #bfdbfe;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 0.92rem;
        white-space: nowrap;
      }
      .result-body {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 18px;
        padding: 20px;
        min-width: 0;
      }
      .result-body > * { min-width: 0; }
      .image-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        min-width: 0;
      }
      .figure {
        background: rgba(15, 23, 42, 0.74);
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 16px;
        padding: 12px;
        min-width: 0;
      }
      .figure strong { display: block; margin-bottom: 8px; }
      .figure img { width: 100%; height: auto; max-width: 100%; border-radius: 12px; display: block; }
      .table-wrap {
        width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .cards-table {
        width: 100%;
        min-width: 480px;
        border-collapse: collapse;
        font-size: 0.92rem;
      }
      .cards-table th,
      .cards-table td {
        padding: 8px 6px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        text-align: left;
        vertical-align: middle;
      }
      .cards-table th { color: var(--muted); font-weight: 600; }
      .card-preview { width: 42px; height: 58px; border-radius: 6px; object-fit: cover; background: #0b1120; display: block; border: 1px solid rgba(148,163,184,.2); }
      .score-badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 0.82rem; font-weight: 700; }
      .score-badge.good { background: rgba(34,197,94,.18); color: #86efac; }
      .score-badge.ok  { background: rgba(234,179,8,.18); color: #fde68a; }
      .score-badge.poor { background: rgba(239,68,68,.18); color: #fca5a5; }
      .feedback-form {
        display: grid;
        gap: 8px;
      }
      .feedback-buttons {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .feedback-status {
        font-size: 0.82rem;
        color: var(--muted);
        max-width: 160px;
      }
      .loading-overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.76);
        backdrop-filter: blur(6px);
        z-index: 1000;
      }
      .loading-overlay.visible { display: flex; }
      .loading-card {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 18px 22px;
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.96);
        border: 1px solid rgba(148, 163, 184, 0.25);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
      }
      .spinner {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 3px solid rgba(148, 163, 184, 0.25);
        border-top-color: var(--accent);
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .empty { color: var(--muted); }
      .muted { color: var(--muted); }
      .danger { color: #fca5a5; }
      .success { color: #86efac; }
      @media (max-width: 980px) {
        .hero, .upload-panel, .result-body { grid-template-columns: 1fr; }
        .summary-grid, .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 700px) {
        .summary-grid, .stats, .image-grid { grid-template-columns: 1fr; }
        .result-head { flex-direction: column; }
        .shell { padding: 20px 12px 40px; }
      }
      @media (max-width: 480px) {
        .shell { padding: 14px 10px 32px; }
        .panel { padding: 14px; }
        .hero h1 { font-size: 1.5rem; }
        .result-body { padding: 12px; }
        .result-head { padding: 12px 14px; }
        .figure { padding: 8px; }
        .figure img { border-radius: 8px; }
        .cards-table { font-size: 0.82rem; }
        .cards-table th, .cards-table td { padding: 6px 5px; }
        .pill { font-size: 0.8rem; padding: 6px 10px; }
        .button.small, button.small { padding: 7px 10px; font-size: 0.82rem; }
      }
    </style>
  </head>
  <body>
    <div class="loading-overlay" id="loading-overlay" aria-live="polite" aria-hidden="true">
      <div class="loading-card">
        <div class="spinner" aria-hidden="true"></div>
        <div>
          <strong>Appraising image…</strong><br />
          <span class="muted">The scanner is detecting cards and estimating the total.</span>
        </div>
      </div>
    </div>
    <div class="shell">
      <nav class="nav">
        <a href="{{ url_for('index') }}" class="active">Appraiser</a>
        <a href="{{ url_for('pipeline_page') }}">Pipeline</a>
        <a href="{{ url_for('benchmark_page') }}">Benchmark</a>
      </nav>

      <section class="hero">
        <div class="panel">
          <h1>Drag page images in and appraise the whole image.</h1>
          <p>
            Upload one or more binder-page photos or card-group images. The appraiser detects a supported layout from the pixels,
            identifies each visible card against the local reference corpus, and estimates the total value for the whole image.
          </p>
        </div>
        <div class="panel">
          <div class="stats">
            <div class="stat">
              <div class="label">Reference cards</div>
              <div class="value">{{ catalog_summary.unique_cards }}</div>
            </div>
            <div class="stat">
              <div class="label">Fixture images</div>
              <div class="value">{{ catalog_summary.pages }}</div>
            </div>
            <div class="stat">
              <div class="label">Known corpus total</div>
              <div class="value">${{ '%.2f' % catalog_summary.fixture_total }}</div>
            </div>
          </div>
        </div>
      </section>

      {% with messages = get_flashed_messages() %}
        {% if messages %}
          <div class="flash">{{ messages[0] }}</div>
        {% endif %}
      {% endwith %}

      <section class="upload-panel">
        <div class="panel">
          <form action="{{ url_for('appraise_images') }}" method="post" enctype="multipart/form-data" id="appraise-form">
            <div class="dropzone" id="dropzone">
              <h2>Drop image files here</h2>
              <p>Supports JPG, PNG, and WebP. You can drop a single card, a binder page, or multiple images at once.</p>
              <div class="upload-actions">
                <label class="button" for="images-input">Choose images</label>
                <button type="submit">Appraise uploaded images</button>
              </div>
              <input id="images-input" type="file" name="images" accept=".jpg,.jpeg,.png,.webp,image/*" multiple required />
              <div class="selected-files" id="selected-files">
                {% if uploads %}
                  {% for upload in uploads %}
                    <div class="file">{{ upload.original_name }}</div>
                  {% endfor %}
                {% else %}
                  <div class="file">No files selected yet.</div>
                {% endif %}
              </div>
            </div>
          </form>
        </div>
        <div class="panel">
          <h2 style="margin-top:0">Current limitations</h2>
          <ul class="help-list">
            <li>The scanner currently works best on layouts similar to the fixture corpus.</li>
            <li>Irregular scattered layouts are now in the benchmark set and currently fail badly.</li>
            <li>Prices come from stable fixture values, not live market fetches.</li>
            <li>Image appraisal is picture-only: the scanner does not read SVG tags or hidden labels.</li>
          </ul>
        </div>
      </section>

      {% if batch_summary %}
        <section class="summary-grid" id="results-section" tabindex="-1">
          <div class="stat"><div class="label">Uploaded images</div><div class="value">{{ batch_summary.image_count }}</div></div>
          <div class="stat"><div class="label">Detected cards</div><div class="value">{{ batch_summary.detected_slots }}</div></div>
          <div class="stat"><div class="label">Predicted batch total</div><div class="value">${{ '%.2f' % batch_summary.predicted_total }}</div></div>
          <div class="stat"><div class="label">Top prediction</div><div class="value">{{ batch_summary.top_card or '—' }}</div></div>
        </section>
      {% endif %}

      {% if results %}
        {% for result in results %}
          <section class="result-card">
            <div class="result-head">
              <div>
                <h3>{{ result.original_name }}</h3>
                <p>{{ result.dimensions[0] }} × {{ result.dimensions[1] }} · {{ result.content_type or 'image' }}</p>
              </div>
              <div class="pill-row">
                <div class="pill">Detected {{ result.slot_count }} card{{ '' if result.slot_count == 1 else 's' }}</div>
                <div class="pill">Predicted total ${{ '%.2f' % result.predicted_total_usd }}</div>
                <div class="pill">Layout {{ result.layout_name }}</div>
              </div>
            </div>
            <div class="result-body">
              <div class="image-grid">
                <div class="figure">
                  <strong>Uploaded image</strong>
                  <img src="{{ result.original_url }}" alt="uploaded image" />
                </div>
                <div class="figure">
                  <strong>Detected cards overlay</strong>
                  <img src="{{ result.annotated_url }}" alt="annotated appraisal" />
                </div>
              </div>
              <div>
                {% if result.slots %}
                  <div class="table-wrap">
                  <table class="cards-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Predicted card</th>
                        <th>Score</th>
                        <th>Price</th>
                        <th>Feedback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {% for slot in result.slots %}
                        {% set score = slot.match_score | float %}
                        {% if score < 0.08 %}
                          {% set badge_class = 'good' %}
                        {% elif score < 0.12 %}
                          {% set badge_class = 'ok' %}
                        {% else %}
                          {% set badge_class = 'poor' %}
                        {% endif %}
                        <tr>
                          <td>{{ loop.index }}</td>
                          <td style="display:flex; gap:10px; align-items:center">
                            {% if slot.card._ref_url %}
                              <img class="card-preview" src="{{ slot.card._ref_url }}" alt="" loading="lazy" />
                            {% endif %}
                            <div>
                              <strong>{{ slot.card.name }}</strong><br />
                              <span class="muted">{{ slot.card.canonical_card_id }}</span>
                            </div>
                          </td>
                          <td><span class="score-badge {{ badge_class }}">{{ '%.4f' % score }}</span></td>
                          <td>${{ '%.2f' % slot.card.fixture_price_usd }}</td>
                          <td>
                            <form class="feedback-form" data-feedback-form action="{{ url_for('submit_feedback') }}" method="post">
                              <input type="hidden" name="image_filename" value="{{ result.image_filename }}" />
                              <input type="hidden" name="original_name" value="{{ result.original_name }}" />
                              <input type="hidden" name="slot_id" value="{{ slot.slot_id }}" />
                              <input type="hidden" name="predicted_card_id" value="{{ slot.card.canonical_card_id }}" />
                              <input type="hidden" name="predicted_card_name" value="{{ slot.card.name }}" />
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
                    </tbody>
                  </table>
                  </div>
                {% else %}
                  <div class="empty">No cards were detected in this image.</div>
                {% endif %}
              </div>
            </div>
          </section>
        {% endfor %}
      {% endif %}
    </div>

    <script>
      const dropzone = document.getElementById('dropzone');
      const input = document.getElementById('images-input');
      const selectedFiles = document.getElementById('selected-files');
      const appraiseForm = document.getElementById('appraise-form');
      const loadingOverlay = document.getElementById('loading-overlay');

      function renderSelectedFiles(files) {
        if (!files || !files.length) {
          selectedFiles.innerHTML = '<div class="file">No files selected yet.</div>';
          return;
        }
        selectedFiles.innerHTML = Array.from(files)
          .map((file) => `<div class="file">${file.name}</div>`)
          .join('');
      }

      input.addEventListener('change', () => renderSelectedFiles(input.files));

      ['dragenter', 'dragover'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
          event.preventDefault();
          dropzone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
          event.preventDefault();
          dropzone.classList.remove('dragover');
        });
      });
      dropzone.addEventListener('drop', (event) => {
        if (event.dataTransfer?.files?.length) {
          input.files = event.dataTransfer.files;
          renderSelectedFiles(input.files);
        }
      });

      appraiseForm.addEventListener('submit', () => {
        if (input.files?.length) {
          loadingOverlay.classList.add('visible');
          loadingOverlay.setAttribute('aria-hidden', 'false');
        }
      });

      const resultsSection = document.getElementById('results-section');
      if (resultsSection) {
        requestAnimationFrame(() => {
          resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }

      document.querySelectorAll('[data-feedback-form]').forEach((form) => {
        const feedbackValue = form.querySelector('[data-feedback-value]');
        const status = form.querySelector('[data-feedback-status]');

        async function sendFeedback(label) {
          const body = new FormData(form);
          const response = await fetch(form.action, { method: 'POST', body });
          const payload = await response.json();
          status.textContent = payload.message || label;
          status.classList.toggle('success', Boolean(payload.ok));
          status.classList.toggle('danger', !payload.ok);
        }

        form.querySelector('[data-feedback-positive]').addEventListener('click', async () => {
          feedbackValue.value = 'up';
          await sendFeedback('👍 Thanks');
        });

        form.querySelector('[data-feedback-negative]').addEventListener('click', async () => {
          feedbackValue.value = 'down';
          await sendFeedback('👎 Marked incorrect');
        });
      });
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


def _score_color(score: float) -> tuple:
    """Return (background_rgba, text_color_rgba) for a match score."""
    if score < 0.08:
        return (34, 197, 94, 210), (255, 255, 255, 255)   # green
    if score < 0.12:
        return (234, 179, 8, 210), (255, 255, 255, 255)    # amber
    return (239, 68, 68, 210), (255, 255, 255, 255)        # red


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
        score = float(slot.get("match_score", 1.0))
        bg, fg = _score_color(score)
        # Translucent fill + solid border
        draw.rounded_rectangle(box, radius=18, outline=(*bg[:3], 255), width=5, fill=(*bg[:3], 55))
        # Multi-line label: index + name + score
        lines = [
            f"#{index} {slot['card'].get('name', '?')}",
            f"{slot['card'].get('canonical_card_id', '?')}  Δ{score:.4f}",
        ]
        label_h = len(lines) * 24 + 16
        label_box = (box[0] + 8, box[1] + 8, min(box[2] - 8, box[0] + 320), min(box[1] + label_h, box[3] - 8))
        draw.rounded_rectangle(label_box, radius=12, fill=(0, 0, 0, 195))
        for li, txt in enumerate(lines):
            draw.text((label_box[0] + 10, label_box[1] + 10 + li * 24), txt, fill=(226, 232, 240, 255), font_size=14)
    image.save(out_path, format="JPEG", quality=92, optimize=True, progressive=True)
    return out_path


def _image_result(scan_report: dict[str, Any], image_path: Path, original_name: str, content_type: str | None) -> dict[str, Any]:
    annotated_path = _annotate_scan(image_path, scan_report)
    with Image.open(image_path) as source_image:
        dimensions = ImageOps.exif_transpose(source_image).size
    # Attach reference image URL to each slot
    manifest = load_manifest(DEFAULT_MANIFEST_PATH)
    ref_map: dict[str, str] = {}
    for page in manifest.get("pages", []):
        for slot in page.get("slots", []):
            card = slot.get("card") or {}
            cid = str(card.get("canonical_card_id", "")).strip()
            rp = str(card.get("reference_image_path", "")).strip()
            if cid and rp and cid not in ref_map:
                ref_map[cid] = rp
    slots = []
    for slot in scan_report.get("slots", []):
        card = dict(slot["card"])
        cid = card.get("canonical_card_id", "")
        if cid in ref_map:
            card["_ref_url"] = url_for("serve_reference_card", path=ref_map[cid])
        elif cid == "empty":
            card["_ref_url"] = url_for("serve_reference_card", path="empty.jpg")
        slot["card"] = card
        slots.append(slot)
    return {
        "image_filename": image_path.name,
        "original_name": original_name,
        "content_type": content_type,
        "dimensions": dimensions,
        "slot_count": int(scan_report.get("slot_count", 0)),
        "predicted_total_usd": float(scan_report.get("predicted_total_usd", 0.0)),
        "slots": slots,
        "layout_name": _classify_layout(int(scan_report.get("slot_count", 0))),
        "original_url": url_for("serve_appraiser_file", kind="uploads", filename=image_path.name),
        "annotated_url": url_for("serve_appraiser_file", kind="annotated", filename=annotated_path.name),
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


from flask import send_from_directory

MANIFEST_ROOT = DEFAULT_MANIFEST_PATH.parent


@app.route("/reference-cards/<path:path>")
def serve_reference_card(path: str):
    """Serve reference card images from the fixture reference_cards directory."""
    ref_dir = MANIFEST_ROOT / "reference_cards"
    full_path = ref_dir / path
    if not full_path.exists() or not full_path.is_file():
        return "Not found", 404
    return send_file(str(full_path))


@app.route("/feedback", methods=["POST"])
def submit_feedback():
    feedback = str(request.form.get("feedback", "")).strip().lower()
    if feedback not in {"up", "down"}:
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
    message = "👍 Thanks" if feedback == "up" else "👎 Marked incorrect"
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


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "7860"))
    debug = os.environ.get("DEBUG", "0") == "1"
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
