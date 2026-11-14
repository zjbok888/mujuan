import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: `${root}web`,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': `${root}shared`,
      '@web': `${root}web/src`,
    },
  },
  build: {
    outDir: `${root}dist`,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: false,
      },
    },
  },
})
