/* drop — frontend logic
 *
 *  - Drag & drop on the dropzone, plus tap-to-select (the <label> wrapping
 *    the <input type=file> gives us mobile tap support for free).
 *  - Upload with progress (XMLHttpRequest because fetch has no upload progress).
 *  - List stored files; auto-refresh every 5s; manual refresh button.
 *  - Preview modal: dispatches on file kind (csv / json / text / image / binary).
 *  - Delete with confirm.
 */

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────────────────
  const dropzone     = document.getElementById('dropzone');
  const fileInput    = document.getElementById('file-input');
  const progressEl   = document.getElementById('progress');
  const progressList = document.getElementById('progress-list');
  const fileList     = document.getElementById('file-list');
  const filesCount   = document.getElementById('files-count');
  const emptyEl      = document.getElementById('empty');
  const refreshBtn   = document.getElementById('refresh-btn');
  const statusDot    = document.getElementById('status-dot');
  const statusText   = document.getElementById('status-text');
  const modal        = document.getElementById('modal');
  const modalTitle   = document.getElementById('modal-title');
  const modalContent = document.getElementById('modal-content');
  const modalDownload= document.getElementById('modal-download');
  const modalDelete  = document.getElementById('modal-delete');

  // Track the file currently shown in the modal so delete can act on it.
  let modalCurrentFile = null;

  // ── API helpers ───────────────────────────────────────────────────────
  async function apiStatus() {
    const r = await fetch('/api/status');
    if (!r.ok) throw new Error('status ' + r.status);
    return r.json();
  }
  async function apiFiles() {
    const r = await fetch('/api/files');
    if (!r.ok) throw new Error('files ' + r.status);
    return r.json();
  }
  async function apiDelete(id) {
    const r = await fetch(`/api/files/${id}`, { method: 'DELETE' });
    return r.ok;
  }
  async function apiPreview(id) {
    const r = await fetch(`/api/files/${id}/preview`);
    if (!r.ok) return null;
    return r.json();
  }

  // ── Upload with progress ──────────────────────────────────────────────
  function uploadFile(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('file', file, file.name);

      xhr.open('POST', '/api/files');

      // Build a progress row
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="pname"></span>
        <span class="pbar"><div></div></span>
        <span class="pstatus">0%</span>
      `;
      li.querySelector('.pname').textContent = file.name;
      progressList.appendChild(li);
      progressEl.hidden = false;
      const bar = li.querySelector('.pbar > div');
      const statusSpan = li.querySelector('.pstatus');

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + '%';
        statusSpan.textContent = pct + '%';
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
            statusSpan.textContent = '✓';
            li.style.opacity = '0.4';
            setTimeout(() => li.remove(), 800);
            resolve(data.uploaded[0]);
          } else {
            statusSpan.textContent = '✗';
            statusSpan.style.color = 'var(--danger)';
            reject(new Error(data.error || `HTTP ${xhr.status}`));
          }
        } catch (e) {
          statusSpan.textContent = '✗';
          reject(e);
        }
        if (progressList.children.length === 0) progressEl.hidden = true;
      };
      xhr.onerror = () => {
        statusSpan.textContent = '✗';
        statusSpan.style.color = 'var(--danger)';
        reject(new Error('Network error'));
      };
      xhr.send(fd);
    });
  }

  async function handleFiles(fileListLike) {
    const files = Array.from(fileListLike);
    if (!files.length) return;
    let ok = 0, fail = 0;
    // Upload sequentially so the UI shows one progress bar at a time.
    // (Parallel uploads are fine but visually noisy on mobile.)
    for (const f of files) {
      try {
        await uploadFile(f);
        ok++;
      } catch (e) {
        console.error('upload failed', f.name, e);
        fail++;
      }
    }
    if (ok > 0) await refreshFiles();
    if (fail > 0) {
      statusText.textContent = `${ok} uploaded, ${fail} failed`;
      statusDot.className = 'dot bad';
    }
  }

  // ── Drag & drop ───────────────────────────────────────────────────────
  // The dropzone is a <label> wrapping the file input. We need to prevent
  // the browser's default "open file in tab" behavior on accidental drops
  // *anywhere* on the page, and route real drops to the dropzone.
  ['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave' && e.target !== dropzone) return;
      dropzone.classList.remove('dragging');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });
  // Also block the page-level default for strays.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  fileInput.addEventListener('change', () => {
    if (fileInput.files) handleFiles(fileInput.files);
    fileInput.value = ''; // allow re-uploading the same file
  });

  // ── Files list ────────────────────────────────────────────────────────
  function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
    if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return '🎬';
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return '🎵';
    if (['pdf'].includes(ext)) return '📕';
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return '🗜️';
    if (['csv', 'tsv'].includes(ext)) return '📊';
    if (['json'].includes(ext)) return '🧾';
    if (['txt', 'md', 'log'].includes(ext)) return '📄';
    if (['py', 'js', 'ts', 'go', 'rs', 'rb', 'sh', 'html', 'css'].includes(ext)) return '⟨⟩';
    return '📦';
  }

  function fmtDate(epoch) {
    const d = new Date(epoch * 1000);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderFileItem(f) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.id = f.id;
    li.innerHTML = `
      <div class="file-icon"></div>
      <div class="file-meta">
        <div class="file-name"></div>
        <div class="file-sub"></div>
      </div>
      <div class="file-actions">
        <button type="button" class="icon-btn primary" data-act="preview" title="Preview">👁</button>
        <a class="icon-btn" title="Download" href="${f.download_url}" download>⬇</a>
        <button type="button" class="icon-btn danger" data-act="delete" title="Delete">🗑</button>
      </div>
    `;
    li.querySelector('.file-icon').textContent = fileIcon(f.name);
    li.querySelector('.file-name').textContent = f.name;
    li.querySelector('.file-sub').textContent = `${f.size_human} · ${fmtDate(f.added_at)}`;
    li.querySelector('[data-act="preview"]').addEventListener('click', () => openPreview(f));
    li.querySelector('[data-act="delete"]').addEventListener('click', () => deleteFile(f, li));
    return li;
  }

  async function refreshFiles() {
    try {
      const data = await apiFiles();
      fileList.innerHTML = '';
      if (!data.files.length) {
        fileList.appendChild(emptyEl);
        emptyEl.hidden = false;
      } else {
        for (const f of data.files) fileList.appendChild(renderFileItem(f));
      }
      filesCount.textContent = `(${data.files.length})`;
    } catch (e) {
      console.error('refresh failed', e);
    }
  }

  async function deleteFile(f, liEl) {
    if (!confirm(`Delete "${f.name}"?`)) return;
    const ok = await apiDelete(f.id);
    if (ok) {
      liEl.remove();
      const remaining = fileList.querySelectorAll('.file-item').length;
      filesCount.textContent = `(${remaining})`;
      if (remaining === 0) fileList.appendChild(emptyEl);
      // Close modal if we just deleted the file being previewed.
      if (modalCurrentFile && modalCurrentFile.id === f.id) closeModal();
    } else {
      alert('Delete failed.');
    }
  }

  // ── Preview modal ─────────────────────────────────────────────────────
  function openPreview(f) {
    modalCurrentFile = f;
    modalTitle.textContent = f.name;
    modalContent.innerHTML = '<div class="preview-meta">Loading preview…</div>';
    modalDownload.href = f.download_url;
    modalDownload.setAttribute('download', f.name);
    modal.hidden = false;
    apiPreview(f.id).then((data) => {
      if (!data) {
        modalContent.innerHTML = '<div class="preview-error">Preview unavailable.</div>';
        return;
      }
      renderPreview(data);
    }).catch((e) => {
      modalContent.innerHTML = `<div class="preview-error">Preview failed: ${e.message}</div>`;
    });
  }

  function renderPreview(data) {
    let html = '';
    const meta = `<div class="preview-meta">${data.size_bytes != null ? humanBytes(data.size_bytes) : ''} · ${data.kind || 'unknown'}</div>`;
    switch (data.kind) {
      case 'csv': {
        const head = (data.headers || []).map(h => `<th>${escapeHtml(h)}</th>`).join('');
        const rows = (data.rows || []).map(r =>
          '<tr>' + r.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>'
        ).join('');
        const truncNote = data.truncated
          ? `<div class="preview-meta">Showing first ${data.rows.length} of ~${data.total_rows} rows.</div>`
          : '';
        html = `${truncNote}<div class="preview-csv"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
        break;
      }
      case 'json': {
        if (data.ok === false) {
          html = `<div class="preview-error">${escapeHtml(data.error || 'Invalid JSON')}</div>`;
        } else {
          html = `<div class="preview-json">${escapeHtml(data.preview)}</div>`;
        }
        break;
      }
      case 'text':
        html = `<div class="preview-text">${escapeHtml(data.preview)}</div>`;
        break;
      case 'image':
        html = `<div class="preview-image"><img src="${modalCurrentFile.raw_url}" alt=""></div>`;
        break;
      case 'binary':
      default:
        html = `<div class="preview-binary">Binary file — no preview. Use <code>Download</code> to save it.</div>`;
        break;
    }
    modalContent.innerHTML = meta + html;
  }

  function closeModal() {
    modal.hidden = true;
    modalCurrentFile = null;
  }

  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
  modalDelete.addEventListener('click', () => {
    if (!modalCurrentFile) return;
    if (!confirm(`Delete "${modalCurrentFile.name}"?`)) return;
    const f = modalCurrentFile;
    apiDelete(f.id).then((ok) => {
      if (ok) {
        closeModal();
        refreshFiles();
      }
    });
  });

  // ── Status poll + auto-refresh ────────────────────────────────────────
  async function refreshStatus() {
    try {
      const s = await apiStatus();
      statusDot.className = 'dot ok';
      const usedPct = (s.storage.used_bytes / (s.storage.max_total_mb * 1024 * 1024) * 100).toFixed(1);
      statusText.textContent = `${s.storage.used_human} used · ${s.files_count} file${s.files_count === 1 ? '' : 's'}`;
    } catch (e) {
      statusDot.className = 'dot bad';
      statusText.textContent = 'offline';
    }
  }

  refreshBtn.addEventListener('click', () => { refreshFiles(); refreshStatus(); });

  // Initial paint
  refreshStatus();
  refreshFiles();
  setInterval(refreshStatus, 10000);
  setInterval(refreshFiles, 5000);

  // ── Utilities ─────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function humanBytes(n) {
    const u = ['B', 'KB', 'MB', 'GB'];
    let f = n, i = 0;
    for (; i < u.length - 1 && f >= 1024; i++) f /= 1024;
    return `${f.toFixed(f < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  }
})();
