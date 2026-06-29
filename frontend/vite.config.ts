import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  server: {
    proxy: {
      '/api':      { target: 'http://127.0.0.1:8765', changeOrigin: true },
      '/ingest':   { target: 'http://127.0.0.1:8765', changeOrigin: true },
      '/session':  { target: 'http://127.0.0.1:8765', changeOrigin: true },
      '/sandbox':  { target: 'http://127.0.0.1:8765', changeOrigin: true },
      '/library':  { target: 'http://127.0.0.1:8765', changeOrigin: true },
      '/ws':       { target: 'ws://127.0.0.1:8765',   changeOrigin: true, ws: true },
    },
  },
})
