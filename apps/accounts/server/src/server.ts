import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { app } from './app.ts'
import { env } from './env.ts'
import { startLibraryRefresh } from './lib/pipeline.ts'

const root = new Hono().route('/', app)

// Production: the API also serves the built web app, with an SPA fallback.
const web = env.WEB_DIST ? resolve(env.WEB_DIST) : null
if (web && existsSync(web)) {
  const index = await Bun.file(resolve(web, 'index.html')).text()
  root.use(
    '/assets/*',
    serveStatic({
      root: web,
      onFound: (_p, c) => {
        c.header('Cache-Control', 'public, max-age=31536000, immutable')
      },
    }),
  )
  root.use('/*', serveStatic({ root: web }))
  root.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound()
    c.header('Cache-Control', 'no-cache')
    return c.html(index)
  })
}

startLibraryRefresh()

export default { port: env.PORT, fetch: root.fetch }
console.log(`accounts on :${env.PORT}`)
