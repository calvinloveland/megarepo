import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Chat app is the default landing page; the WebGPU smoke test is a
      // secondary diagnostic page at /webgpu.html.
      input: {
        index: path.resolve(__dirname, 'index.html'),
        webgpu: path.resolve(__dirname, 'webgpu.html'),
      },
    },
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      events: 'events',
      util: 'util',
      stream: 'stream-browserify',
      buffer: 'buffer',
      process: 'process/browser',
    },
  },
  optimizeDeps: {
    include: ['events', 'util', 'stream-browserify', 'buffer', 'process'],
    exclude: ['@mlc-ai/web-llm'],
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
