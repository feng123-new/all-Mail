import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:3002'

const proxyEnvKeys = [
  'NODE_USE_ENV_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
] as const

for (const key of proxyEnvKeys) {
  delete process.env[key]
}

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
      '/mail/api': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/ingress': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/oauth': {
        target: devProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    testTimeout: 15000,
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
