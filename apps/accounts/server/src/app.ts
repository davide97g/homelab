import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { auth } from './auth.ts'
import type { AppEnv } from './context.ts'
import { pool } from './db/client.ts'
import { env } from './env.ts'
import { adminRoutes } from './routes/admin.ts'
import { appRoutes } from './routes/apps.ts'
import { deviceRoutes } from './routes/device.ts'
import { inviteRoutes } from './routes/invites.ts'
import { meRoutes } from './routes/me.ts'
import { wellKnownRoutes } from './routes/wellknown.ts'
import { UpstreamError } from './upstream/http.ts'

const origins = new Set([env.APP_URL, ...env.TRUSTED_ORIGINS])

const api = new Hono<AppEnv>()
  .basePath('/api')
  // The other apps (cinema.…, memories.…) call the broker with the shared cookie.
  .use(
    cors({
      origin: (o) => (origins.has(o) ? o : null),
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['set-auth-token'],
      maxAge: 600,
    }),
  )
  .get('/health', async (c) => {
    await pool.query('select 1')
    return c.json({ ok: true })
  })
  .on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
  // Authenticated by the phone app's own upstream token, not a session.
  .route('/device', deviceRoutes)
  .use(async (c, next) => {
    const r = await auth.api.getSession({ headers: c.req.raw.headers })
    c.set('user', r?.user ?? null)
    c.set('session', r?.session ?? null)
    await next()
  })
  .route('/invites', inviteRoutes)
  .route('/me', meRoutes as never)
  .route('/apps', appRoutes as never)
  .route('/admin', adminRoutes as never)

api.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  if (err instanceof UpstreamError) {
    console.error(err.message)
    return c.json({ error: `${err.app} non risponde come dovrebbe (${err.status})` }, 502)
  }
  console.error(err)
  return c.json({ error: 'Errore del server, riprova' }, 500)
})
api.notFound((c) => c.json({ error: 'Non trovato' }, 404))

export const app = new Hono().route('/.well-known', wellKnownRoutes).route('/', api)
