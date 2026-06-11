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
    build: {
      rollupOptions: {
        output: {
          // Separar SOLO los vendors estables grandes que ya son eager, en chunks
          // propios: bajan en paralelo con el resto y sobreviven a los deploys (el
          // hash del código de app cambia, el de React/framer no), así un rebuild no
          // obliga a re-descargar todo en frío. NO usar catch-all de node_modules:
          // eso arrastraría a eager libs que hoy viven solo en chunks lazy. El resto
          // (router, recharts/d3, lucide, etc.) lo deja Vite con su heurística por
          // defecto (async-only se mantiene async).
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            // Solo core de React (sin deps externas) para evitar chunks circulares.
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
              return 'vendor-react';
            }
            if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
              return 'vendor-motion';
            }
            if (id.includes('@tanstack')) return 'vendor-query';
          },
        },
      },
    },
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
