import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Must match the server's PORT; override both to run a second copy side by side.
const api = `http://localhost:${process.env.API_PORT ?? 3001}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    // Fixed: localStorage (current track, volume, settings) is per origin, so a port change would reset it.
    port: Number(process.env.WEB_PORT ?? 5174),
    strictPort: true,
    proxy: {
      '/api': api,
      '/media': api,
    },
  },
})
