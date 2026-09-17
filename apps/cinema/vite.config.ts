import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const jellyfinTarget = env.JELLYFIN_URL || 'http://localhost:8096'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      port: 5173,
      proxy: {
        // Everything the SDK does goes through here. Same-origin in the
        // browser, so CORS never enters the picture -- and video byte-range
        // requests are forwarded untouched.
        '/jf': {
          target: jellyfinTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/jf/, ''),
        },
      },
    },
  }
})
