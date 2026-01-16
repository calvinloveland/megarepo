#!/usr/bin/env node
/**
 * HiveMind LLM - Single command startup
 * 
 * Starts both the coordinator server and Vite dev server
 * Usage: npm start
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coordDir = join(__dirname, '..', 'coordinator');

console.log('🐝 Starting HiveMind LLM...\n');

// Start coordinator server
console.log('📡 Starting coordinator server on port 5000...');
const coordinator = spawn('python', ['app.py'], {
  cwd: coordDir,
  stdio: 'pipe',
  env: { ...process.env, PYTHONUNBUFFERED: '1' }
});

coordinator.stdout.on('data', (data) => {
  process.stdout.write(`[Coordinator] ${data}`);
});

coordinator.stderr.on('data', (data) => {
  process.stderr.write(`[Coordinator] ${data}`);
});

coordinator.on('error', (err) => {
  console.error('Failed to start coordinator:', err.message);
  console.log('\nMake sure you have installed the coordinator:');
  console.log('  cd ../coordinator && pip install -e .');
  process.exit(1);
});

// Wait a moment for coordinator to start, then start Vite
setTimeout(() => {
  console.log('\n🌐 Starting Vite dev server on port 5173...');
  const vite = spawn('npx', ['vite'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  vite.on('error', (err) => {
    console.error('Failed to start Vite:', err.message);
    coordinator.kill();
    process.exit(1);
  });

  // Cleanup on exit
  const cleanup = () => {
    console.log('\n\n🛑 Shutting down...');
    coordinator.kill();
    vite.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
}, 1000);
