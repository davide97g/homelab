import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Monorepo: .env lives at the repo root (two levels up), shared with
// services/jellyfin/dev.sh so the container and the proxy can never disagree
// about where Jellyfin is.
const repoRoot = path.resolve(import.meta.dirname, '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')
  const jellyfinTarget = env.JELLYFIN_URL || 'http://localhost:8096'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    envDir: repoRoot,
    build: {
      rolldownOptions: {
        output: {
          // `lib/jellyfin/` is the only importer of @jellyfin/sdk, and it is
          // imported from both the app shell and the lazily-loaded player. Left
          // alone, each route chunk inlines its own copy of the SDK -- the same
          // parse and execute paid twice on a phone. One group, referenced by
          // both.
          advancedChunks: {
            groups: [
              {
                name: 'jellyfin-sdk',
                test: /node_modules[\\/](@jellyfin[\\/]sdk|axios)[\\/]/,
              },
              // hls.js is the player's alone and stays behind the same lazy
              // import; splitting it out only means a deploy that touches the
              // player does not re-download 400 kB of unchanged decoder.
              {
                name: 'hls',
                test: /node_modules[\\/]hls\.js[\\/]/,
              },
            ],
          },
        },
      },
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
