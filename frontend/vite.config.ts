import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicAppUrl = env.VITE_PUBLIC_APP_URL?.trim()
  const publicAppHost = publicAppUrl ? new URL(publicAppUrl).hostname : undefined
  const proxyTarget = env.VITE_DEV_PROXY_TARGET?.trim() || 'http://localhost:8000'

  return {
    plugins: [react()],
    optimizeDeps: {
      include: ['@sentry/react', 'react-qr-code'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      allowedHosts: publicAppHost ? [publicAppHost, '.trycloudflare.com'] : ['.trycloudflare.com'],
      watch: {
        usePolling: true,
        interval: 300,
      },
      hmr: {
        host: 'localhost',
        protocol: 'ws',
        clientPort: 3000,
        port: 3000,
      },
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
