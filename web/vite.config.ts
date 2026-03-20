import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:3002'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/api': {
        target: devProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1600,
  },
})
