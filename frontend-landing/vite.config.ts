import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vitePrerenderPlugin } from 'vite-prerender-plugin';

export default defineConfig({
  plugins: [
    react(),
    vitePrerenderPlugin({
      renderTarget: '#root',
      prerenderScript: fileURLToPath(new URL('./src/main.tsx', import.meta.url)),
    }),
  ],
  build: {
    outDir: '../landing',
    emptyOutDir: true,
  },
});
