import { defineConfig, loadEnv, type PluginOption, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The app always talks to a same-origin `/api` (Immich's API root). In
// production the host in front of the static files proxies /api to Immich; in
// dev Vite does it. Override the upstream with IMMICH_URL (the server root,
// i.e. what the native apps are given -- `/api` is appended here).
const DEFAULT_IMMICH = 'https://memories.davideghiotto.it/immich'

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')
  const mock = process.env.MEMORIES_MOCK === '1' || env.MEMORIES_MOCK === '1'
  const upstream = (env.IMMICH_URL || DEFAULT_IMMICH).replace(/\/+$/, '')

  const plugins: PluginOption[] = [react(), tailwindcss()]
  if (mock) {
    // Dev-only: the fixture server is a Vite middleware, so nothing from
    // mock/ can ever reach the production bundle.
    const { mockImmich } = await import('./mock/plugin.ts')
    plugins.push(mockImmich())
  }

  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: upstream,
      changeOrigin: true,
      ws: true,
      secure: true,
      // Immich sets immich_access_token with `Secure` (it sees https via the
      // tunnel). On http://localhost the browser would drop it, and every
      // <img src="/api/..."> would 401. Re-scope the cookie to localhost.
      cookieDomainRewrite: '',
      cookiePathRewrite: '/',
      configure: (p) => {
        p.on('proxyRes', (res) => {
          const sc = res.headers['set-cookie']
          if (sc) res.headers['set-cookie'] = sc.map((c) => c.replace(/;\s*Secure/gi, ''))
        })
      },
    },
  }

  return {
    plugins,
    resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
    server: { port: 5180, proxy: mock ? undefined : proxy },
    preview: { port: 5181, proxy },
    build: { target: 'es2022', sourcemap: false },
  }
})
