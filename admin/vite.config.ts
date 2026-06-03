import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// La app del dashboard se sirve bajo /admin-ui/ (estático en el backend).
// base controla cómo resuelven los assets; outDir → dist (lo monta el compose).
export default defineConfig({
  plugins: [react()],
  base: '/admin-ui/',
  resolve: {
    alias: { '@': path.join(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5400,
    proxy: {
      // En dev, proxyeamos /admin al backend para same-origin.
      '/admin': { target: 'http://localhost:4400', changeOrigin: true },
    },
  },
})
