import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const api = process.env.ACCOUNTS_API ?? 'http://localhost:3190'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { port: 5190, proxy: { '/api': api, '/.well-known': api } },
  build: { target: 'es2022', sourcemap: false },
})
