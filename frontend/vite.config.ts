import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_API_URL || 'http://127.0.0.1:8765'
  const backendWs  = backendUrl.replace(/^http/, 'ws')

  return {
    plugins: [react()],
    worker: {
      format: 'es',
    },
    optimizeDeps: {
      include: ['pdfjs-dist'],
    },
    server: {
      proxy: {
        '/api':         { target: backendUrl, changeOrigin: true },
        '/ingest':      { target: backendUrl, changeOrigin: true },
        '/session':     { target: backendUrl, changeOrigin: true },
        '/sandbox':     { target: backendUrl, changeOrigin: true },
        '/library':     { target: backendUrl, changeOrigin: true },
        '/annotations': { target: backendUrl, changeOrigin: true },
        '/regions':     { target: backendUrl, changeOrigin: true },
        '/review':      { target: backendUrl, changeOrigin: true },
        '/ws':          { target: backendWs,  changeOrigin: true, ws: true },
      },
    },
  }
})
