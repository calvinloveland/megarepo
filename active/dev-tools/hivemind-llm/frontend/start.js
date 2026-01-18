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

// Track PIDs for cleanup
let coordinatorPid = null;
let vitePid = null;

// Start coordinator server
console.log('📡 Starting coordinator server on port 5000...');
const coordinator = spawn('python', ['app.py'], {
  cwd: coordDir,
  stdio: 'pipe',
  env: { ...process.env, PYTHONUNBUFFERED: '1', FLASK_ENV: 'production' }
});
coordinatorPid = coordinator.pid;

coordinator.stdout.on('data', (data) => {
  process.stdout.write(`[Coordinator] ${data}`);
});

coordinator.stderr.on('data', (data) => {
  // Filter out Flask debugger noise
  const msg = data.toString();
  if (!msg.includes('Debugger') && !msg.includes('Restarting with stat')) {
    process.stderr.write(`[Coordinator] ${data}`);
  }
});

coordinator.on('error', (err) => {
  console.error('Failed to start coordinator:', err.message);
  console.log('\nMake sure you have installed the coordinator:');
  console.log('  cd ../coordinator && pip install -e .');
  process.exit(1);
});

coordinator.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error(`Coordinator exited with code ${code}`);
  }
});

// Wait a moment for coordinator to start, then start Vite
setTimeout(() => {
  console.log('🌐 Starting Vite dev server on port 5173...\n');
  
  // Run vite with --clearScreen false to avoid TTY issues
  const vite = spawn('npx', ['vite', '--clearScreen', 'false'], {
    cwd: __dirname,
    stdio: 'pipe',
    shell: true
  });
  vitePid = vite.pid;

  vite.stdout.on('data', (data) => {
    const msg = data.toString();
    process.stdout.write(msg);
    
    // Once Vite is ready, print the access URL prominently
    if (msg.includes('Local:')) {
      console.log('\n✅ HiveMind LLM is ready!');
      console.log('   Open http://localhost:5173 in your browser\n');
    }
  });

  vite.stderr.on('data', (data) => {
    process.stderr.write(`[Vite] ${data}`);
  });

  vite.on('error', (err) => {
    console.error('Failed to start Vite:', err.message);
    cleanup();
  });

  vite.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`Vite exited with code ${code}`);
    }
    cleanup();
  });

}, 1500);

// Cleanup on exit
const cleanup = () => {
  console.log('\n🛑 Shutting down...');
  if (coordinatorPid) {
    try { process.kill(coordinatorPid, 'SIGTERM'); } catch {}
  }
  if (vitePid) {
    try { process.kill(vitePid, 'SIGTERM'); } catch {}
  }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
