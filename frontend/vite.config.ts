import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../web/dist', emptyOutDir: true },
  server: {
    proxy: {
      // Page data and form actions use the existing Go URLs and security checks.
      '/backend': {
        target: process.env.CADDYUI_DEV_BACKEND || 'http://127.0.0.1:8082',
        rewrite: (path) => path.replace(/^\/backend/, ''),
      },
    },
  },
})
