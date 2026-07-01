/* ─── image-vae demo: interactive compression playground ─── */

document.addEventListener('DOMContentLoaded', () => {

  // ─── Refs ───
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const uploadLink = document.getElementById('uploadLink');
  const entropyCheck = document.getElementById('entropyCheck');
  const progressBar = document.getElementById('progressBar');
  const progressFill = progressBar.querySelector('.progress-fill');
  const progressText = progressBar.querySelector('.progress-text');
  const results = document.getElementById('results');
  const origImg = document.getElementById('origImg');
  const reconImg = document.getElementById('reconImg');
  const origSize = document.getElementById('origSize');
  const reconSize = document.getElementById('reconSize');
  const statOrigSize = document.getElementById('statOrigSize');
  const statCompSize = document.getElementById('statCompSize');
  const statRatio = document.getElementById('statRatio');
  const statLatentDim = document.getElementById('statLatentDim');
  const statQuantRange = document.getElementById('statQuantRange');
  const statEntropy = document.getElementById('statEntropy');
  const downloadBtn = document.getElementById('downloadBtn');

  // Analyzer refs
  const analyzerDropZone = document.getElementById('analyzerDropZone');
  const vaeFileInput = document.getElementById('vaeFileInput');
  const analyzerResults = document.getElementById('analyzerResults');
  const analyzerBody = document.getElementById('analyzerBody');

  // Hero ratio
  const heroRatio = document.getElementById('heroRatio');

  // ─── State ───
  let compressedDataB64 = null;

  // ─── Upload handlers ───
  function triggerUpload() { fileInput.click(); }
  uploadLink.addEventListener('click', (e) => { e.preventDefault(); triggerUpload(); });
  dropZone.addEventListener('click', triggerUpload);

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) compressFile(fileInput.files[0]);
  });

  // Drag-and-drop for main demo
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) compressFile(e.dataTransfer.files[0]);
  });

  // Drag-and-drop for analyzer
  analyzerDropZone.addEventListener('dragover', (e) => { e.preventDefault(); analyzerDropZone.style.borderColor = 'var(--accent)'; });
  analyzerDropZone.addEventListener('dragleave', () => analyzerDropZone.style.borderColor = '');
  analyzerDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    analyzerDropZone.style.borderColor = '';
    if (e.dataTransfer.files.length) analyzeFile(e.dataTransfer.files[0]);
  });
  analyzerDropZone.addEventListener('click', () => vaeFileInput.click());
  vaeFileInput.addEventListener('change', () => {
    if (vaeFileInput.files.length) analyzeFile(vaeFileInput.files[0]);
  });

  // ─── Compression ───
  async function compressFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      return;
    }

    // Show progress
    results.hidden = true;
    progressBar.hidden = false;
    progressFill.style.width = '0%';
    progressText.textContent = 'Reading image…';
    progressText.classList.add('loading-pulse');

    const formData = new FormData();
    formData.append('image', file);
    formData.append('entropy', entropyCheck.checked ? 'true' : 'false');

    try {
      progressFill.style.width = '30%';
      progressText.textContent = 'Encoding & quantizing…';

      const resp = await fetch('/api/compress', { method: 'POST', body: formData });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      progressFill.style.width = '70%';
      progressText.textContent = 'Decoding…';

      const data = await resp.json();

      progressFill.style.width = '100%';
      progressText.textContent = 'Done!';
      progressText.classList.remove('loading-pulse');

      // Show results
      displayResults(data, file.name);
    } catch (err) {
      progressText.textContent = `Error: ${err.message}`;
      progressText.classList.remove('loading-pulse');
      progressFill.style.width = '0%';
      progressFill.style.background = 'var(--red)';
    }
  }

  function displayResults(data, filename) {
    // Images
    origImg.src = `data:image/jpeg;base64,${data.original_image}`;
    reconImg.src = `data:image/jpeg;base64,${data.reconstructed_image}`;

    // File sizes
    origSize.textContent = formatBytes(data.original_size);
    reconSize.textContent = formatBytes(data.compressed_size);

    // Stats table
    statOrigSize.textContent = formatBytes(data.original_size);
    statCompSize.textContent = `${data.compressed_size_kb} KB (${data.compressed_size} bytes)`;
    statRatio.textContent = data.ratio;
    statLatentDim.textContent = data.latent_dim;
    statQuantRange.textContent = `[${data.q_min}, ${data.q_max}]`;
    statEntropy.textContent = data.entropy_coded ? '✓ Huffman' : '— raw';

    // Hero ratio
    heroRatio.textContent = `${data.ratio}:1`;

    // Download button
    compressedDataB64 = data.compressed_data;
    downloadBtn.href = `data:application/octet-stream;base64,${data.compressed_data}`;
    downloadBtn.download = filename.replace(/\.[^.]+$/, '') + '.vae';
    downloadBtn.textContent = `⬇ Download .vae (${data.compressed_size_kb} KB)`;

    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── Analyzer ───
  async function analyzeFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch('/api/analyze', { method: 'POST', body: formData });
      if (!resp.ok) {
        const err = await resp.json();
        alert(err.error || `HTTP ${resp.status}`);
        return;
      }
      const d = await resp.json();
      displayAnalysis(d);
    } catch (err) {
      alert(`Analyzer error: ${err.message}`);
    }
  }

  function displayAnalysis(d) {
    analyzerBody.innerHTML = '';
    const rows = [
      ['0x00', '4', 'Magic', `<span class="val-accent">${d.magic}</span>`],
      ['0x04', '4', 'Width', `${d.width} px`],
      ['0x08', '4', 'Height', `${d.height} px`],
      ['0x0C', '4', 'Latent dim', `${d.latent_dim}`],
      ['0x10', '4', 'q_min', `${d.q_min}`],
      ['0x14', '4', 'q_max', `${d.q_max}`],
      ['0x18', '4', 'Flags', `${d.flags}${d.entropy_coded ? ' <span class="val-accent">(entropy)</span>' : ''}`],
      ['0x1C', `${d.header_size}`, 'Header total', `${d.header_size} bytes`],
      ['—', `${d.table_size}`, 'Huffman table', `${d.table_size} bytes (if entropy coded)`],
      ['—', `${d.latent_data_size}`, 'Latent data', `${d.latent_data_size} bytes (${d.latent_dim} × 8-bit)`],
      ['—', `${d.file_size}`, '<strong>Total</strong>', `<strong class="val-accent">${d.file_size} bytes (${d.file_size_kb} KB)</strong>`],
    ];
    for (const [off, size, field, val] of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${off}</td><td>${size}</td><td>${field}</td><td>${val}</td>`;
      analyzerBody.appendChild(tr);
    }
    analyzerResults.hidden = false;
    analyzerResults.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ─── Helpers ───
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // ─── Init: show compression stats from server ───
  fetch('/api/status')
    .then(r => r.json())
    .then(status => {
      statLatentDim.textContent = status.latent_dim;
    })
    .catch(() => {});
});
