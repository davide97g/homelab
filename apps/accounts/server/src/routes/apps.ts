import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { type AppId, APPS } from '../db/schema.ts'
import { issueToken } from '../lib/broker.ts'
import { type AuthedEnv, requireUser } from '../context.ts'

const body = z.object({
  deviceId: z.string().min(8).max(128),
  deviceName: z.string().min(1).max(80),
  client: z.string().min(1).max(40).default('Cinema'),
  version: z.string().max(20).default('1.0.0'),
})

/**
 * POST /api/apps/:app/token — the broker. Called with the shared cookie (web)
 * or `Authorization: Bearer <session token>` (TV after the device flow, native
 * apps after an OTP sign-in). Answers with the app's own token.
 */
export const appRoutes = new Hono<AuthedEnv>().use(requireUser).post('/:app/token', async (c) => {
  const app = c.req.param('app')
  if (!(APPS as readonly string[]).includes(app)) throw new HTTPException(404, { message: 'App sconosciuta' })
  const parsed = body.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new HTTPException(400, { message: 'Dati del dispositivo mancanti' })
  const d = parsed.data
  const u = c.get('user')
  const r = await issueToken(u, c.get('session').id, app as AppId, {
    id: d.deviceId,
    name: d.deviceName,
    client: d.client,
    version: d.version,
  })
  c.header('Cache-Control', 'no-store')
  return c.json(r)
})
