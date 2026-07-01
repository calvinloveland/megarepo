#!/usr/bin/env node
// Vroomon deploy guide — local web server, no secrets through chat.
//
// Start:
//   node scripts/deploy-guide.mjs
//
// Then open http://localhost:5113 in your browser.
// The token you paste stays on your machine.

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const SECRETS_DIR = resolve(PROJECT_ROOT, ".secrets");
const SECRETS_FILE = resolve(SECRETS_DIR, "cloudflared-token");
const PORT = 5113;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vroomon Deploy Guide</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; --bg: #08111f; --text: #edf2f7; --muted: #97abc7; --accent: #8ab4ff; --success: #49dcb1; --danger: #f87171; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); display: grid; place-items: center; padding: 2rem; }
  .card { background: rgba(11,19,33,0.94); border: 1px solid rgba(125,148,186,0.22); border-radius: 24px; padding: 2rem; max-width: 640px; width: 100%; box-shadow: 0 28px 60px rgba(0,0,0,0.34); }
  h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
  h1 span { color: var(--accent); }
  p { color: var(--muted); margin: 0.5rem 0; line-height: 1.5; }
  ol { padding-left: 1.2rem; }
  li { margin: 0.4rem 0; color: var(--muted); line-height: 1.4; }
  code { background: rgba(8,17,31,0.8); padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 0.88rem; }
  label { display: block; margin: 1rem 0 0.3rem; font-weight: 600; color: var(--text); }
  input[type=password], input[type=text] { width: 100%; padding: 0.8rem 1rem; border-radius: 12px; border: 1px solid rgba(125,148,186,0.28); background: rgba(9,16,30,0.92); color: var(--text); font: inherit; font-family: monospace; letter-spacing: 0.05em; }
  .status { margin: 0.6rem 0; padding: 0.6rem 0.8rem; border-radius: 10px; font-size: 0.9rem; }
  .status--ok { background: rgba(73,220,177,0.12); border: 1px solid rgba(73,220,177,0.3); color: var(--success); }
  .status--err { background: rgba(248,113,113,0.12); border: 1px solid rgba(248,113,113,0.3); color: var(--danger); }
  .status--info { background: rgba(138,180,255,0.1); border: 1px solid rgba(138,180,255,0.2); color: var(--accent); }
  button { width: 100%; padding: 0.9rem 1rem; border-radius: 12px; border: 1px solid rgba(138,180,255,0.48); background: linear-gradient(180deg,#3d7dff,#2256c4); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; margin: 0.5rem 0; transition: transform 0.1s, box-shadow 0.1s; }
  button:hover { transform: translateY(-1px); box-shadow: 0 12px 24px rgba(34,86,196,0.3); }
  button:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
  button.secondary { background: rgba(32,46,70,0.98); border-color: rgba(125,148,186,0.28); }
  .steps { margin-bottom: 1rem; }
  .step { display: flex; gap: 0.6rem; align-items: start; padding: 0.5rem 0; border-bottom: 1px solid rgba(125,148,186,0.08); }
  .step:last-child { border-bottom: none; }
  .step-num { background: var(--accent); color: #08111f; font-weight: 700; width: 22px; height: 22px; border-radius: 99px; display: flex; align-items: center; justify-content: center; font-size: 0.78rem; flex-shrink: 0; }
  .step-num.done { background: var(--success); }
  .step-text { flex: 1; }
  .step-text .label { font-weight: 600; }
  pre { background: rgba(8,17,31,0.9); padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.82rem; overflow-x: auto; margin: 0.4rem 0; }
  @media (max-width:500px) { .card { padding: 1.2rem; } }
</style>
</head>
<body>
<div class="card">
  <h1>🏎️ Vroomon <span>Deploy</span></h1>
  <p>Deploy vroomon to <code>vroomon.shsw.dev</code> from your local machine.</p>

  <div id="status"></div>

  <div class="steps" id="steps">
    <div class="step" id="step1">
      <div class="step-num" id="num1">1</div>
      <div class="step-text">
        <div class="label">Paste the Cloudflare tunnel token</div>
        <input type="password" id="token-input" placeholder="Paste eyJ... token here" />
      </div>
    </div>
    <div class="step" id="step2">
      <div class="step-num" id="num2">2</div>
      <div class="step-text">
        <div class="label">Write token to disk</div>
        <p>Saves to <code>.secrets/cloudflared-token</code> (gitignored).</p>
        <button id="write-btn">Write token &amp; validate</button>
      </div>
    </div>
    <div class="step" id="step3">
      <div class="step-num" id="num3">3</div>
      <div class="step-text">
        <div class="label">Deploy</div>
        <p>Docker build, push, create K8s secret, apply manifest.</p>
        <button id="deploy-btn" disabled>Deploy</button>
        <pre id="deploy-output" style="display:none"></pre>
      </div>
    </div>
  </div>

  <p style="font-size:0.78rem;color:var(--muted);text-align:center;margin-top:1rem;">
    Token stays on your machine. No data sent through the internet or this chat.
  </p>
</div>

<script>
const tokenInput = document.getElementById('token-input');
const writeBtn = document.getElementById('write-btn');
const deployBtn = document.getElementById('deploy-btn');
const statusDiv = document.getElementById('status');
const num1 = document.getElementById('num1');
const num2 = document.getElementById('num2');
const num3 = document.getElementById('num3');
const deployOutput = document.getElementById('deploy-output');

function setStatus(text, type) {
  statusDiv.innerHTML = '<div class="status status--' + type + '">' + text + '</div>';
}

writeBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) { setStatus('Paste a token first.', 'err'); return; }
  if (!token.startsWith('eyJ')) { setStatus('That does not look like a valid JWT token. It should start with "eyJ".', 'err'); return; }

  writeBtn.disabled = true;
  writeBtn.textContent = 'Writing...';

  try {
    const res = await fetch('/api/write-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (data.ok) {
      setStatus('Token written to ' + data.path, 'ok');
      num1.classList.add('done');
      num2.classList.add('done');
      deployBtn.disabled = false;
    } else {
      setStatus('Error: ' + data.error, 'err');
    }
  } catch (e) {
    setStatus('Error: ' + e.message, 'err');
  } finally {
    writeBtn.disabled = false;
    writeBtn.textContent = 'Write token & validate';
  }
});

deployBtn.addEventListener('click', async () => {
  deployBtn.disabled = true;
  deployBtn.textContent = 'Deploying...';
  deployOutput.style.display = 'block';
  deployOutput.textContent = 'Starting deploy...\\n';

  try {
    const res = await fetch('/api/deploy', { method: 'POST' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) {
        const text = decoder.decode(value);
        deployOutput.textContent += text;
        deployOutput.scrollTop = deployOutput.scrollHeight;
      }
    }
    setStatus('Deploy complete! Check https://vroomon.shsw.dev', 'ok');
    num3.classList.add('done');
    deployBtn.textContent = 'Deployed';
  } catch (e) {
    setStatus('Deploy error: ' + e.message, 'err');
    deployBtn.disabled = false;
    deployBtn.textContent = 'Retry deploy';
  }
});
</script>
</body>
</html>`;

function serveHtml(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  if (req.method === 'POST' && url.pathname === '/api/write-token') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        if (!token || typeof token !== 'string') {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Missing token' }));
          return;
        }
        if (!token.startsWith('eyJ')) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Token should start with "eyJ"' }));
          return;
        }
        if (!existsSync(SECRETS_DIR)) mkdirSync(SECRETS_DIR, { recursive: true });
        writeFileSync(SECRETS_FILE, token, 'utf8');
        res.writeHead(200); res.end(JSON.stringify({ ok: true, path: SECRETS_FILE }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/deploy') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
    });
    const log = (msg) => {
      res.write(`[${new Date().toLocaleTimeString()}] ${msg}\n`);
    };
    const finish = (code) => {
      res.write(`\nExit code: ${code}\n`);
      res.end();
    };
    // Run deploy synchronously; output is captured and sent to the page
    const child = spawnSync(
      'bash',
      [resolve(__dirname, 'deploy-from-secrets.sh')],
      { cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' }
    );
    log((child.stdout ?? '').trim());
    if (child.stderr) log('stderr: ' + child.stderr.trim());
    finish(child.status ?? 1);
    return;
  }

  // Serve the HTML page
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(HTML);
}

const HOST = process.env.VROOMON_DEPLOY_HOST ?? "0.0.0.0";

const server = createServer((req, res) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  try { serveHtml(req, res); } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🏎️  Vroomon Deploy Guide`);
  console.log(`  ─────────────────────`);
  console.log(`  Open in your browser:`);
  console.log(`    http://localhost:${PORT}`);
  console.log(`    http://haswell:${PORT}  (if this machine is reachable as "haswell")`);
  console.log(`\n  Paste the Cloudflare tunnel token into the password field.`);
  console.log(`  It stays on your machine — never sent through chat.\n`);
});
