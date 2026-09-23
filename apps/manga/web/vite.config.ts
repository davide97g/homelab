import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Kavita is reached only through `/api` on our own origin: this proxy in
// development, nginx in the container. Same origin, so no CORS, and the
// apiKey on image URLs never leaves the LAN host.
const kavita = process.env.KAVITA_URL || 'http://localhost:5001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 4571,
    proxy: { '/api': { target: kavita, changeOrigin: true } },
  },
})
