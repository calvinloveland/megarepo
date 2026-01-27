#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'materials');
const DST = path.resolve(__dirname, '..', 'frontend', 'public', 'materials');

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true});
}

function readMaterialMeta(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(txt);
    return {name: obj.name || path.basename(file), description: obj.description || ''};
  } catch (e) {
    return {name: path.basename(file), description: ''};
  }
}

function syncOnce() {
  ensureDir(DST);
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.json'));
  const index = [];
  for (const f of files) {
    const s = path.join(SRC, f);
    const d = path.join(DST, f);
    fs.copyFileSync(s, d);
    index.push({file: f, ...readMaterialMeta(s)});
  }
  fs.writeFileSync(path.join(DST, 'index.json'), JSON.stringify({materials: index}, null, 2));
  console.log('[sync_materials] synced', files.length, 'materials');
}

function watch() {
  syncOnce();
  console.log('[sync_materials] watching', SRC);
  fs.watch(SRC, {persistent:true}, (evt, fname) => {
    if (!fname || !fname.endsWith('.json')) return;
    // debounce naive
    setTimeout(() => {
      try { syncOnce(); } catch (e) { console.warn('sync error', e); }
    }, 100);
  });
}

const args = process.argv.slice(2);
if (args.includes('--watch') || args.includes('-w')) watch();
else syncOnce();
