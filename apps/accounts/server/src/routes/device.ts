import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { DEVICE_CLIENTS } from '../auth.ts'
import { db } from '../db/client.ts'
import { APPS, appAccess, deviceCode, user as userTable } from '../db/schema.ts'
import * as immich from '../upstream/immich.ts'
import * as jellyfin from '../upstream/jellyfin.ts'
import { UpstreamError } from '../upstream/http.ts'

const body = z.object({
  app: z.enum(APPS),
  userCode: z.string().min(4).max(16),
  action: z.enum(['check', 'approve', 'deny']),
})

const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * POST /api/device/with-app — a TV's code approved from the phone app, with the phone's own
 * Immich/Jellyfin token instead of an accounts session, so scanning the QR is one tap and
 * no email code.
 *
 * The token proves who is holding the phone: the upstream says which user it belongs to, and
 * that user must be linked here (app_access, active). It only approves TVs of the same app
 * (memories-tv with a Memories token), never anything else, and it never hands out a session.
 */
export const deviceRoutes = new Hono().post('/with-app', async (c) => {
  const parsed = body.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) throw new HTTPException(400, { message: 'Richiesta non valida' })
  const { app, action } = parsed.data
  const userCode = normalize(parsed.data.userCode)
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new HTTPException(401, { message: 'Token mancante' })

  // 1. Whose token is it, upstream?
  let upstreamId: string
  try {
    upstreamId = app === 'memories' ? (await immich.whoAmI(token)).id : (await jellyfin.whoAmI(token)).Id
  } catch (e) {
    if (e instanceof UpstreamError && (e.status === 401 || e.status === 403))
      throw new HTTPException(401, { message: "L'accesso dell'app è scaduto: rientra nell'app" })
    throw e
  }

  // 2. Which homelab account is linked to that upstream user?
  const [link] = await db
    .select({ userId: appAccess.userId, name: userTable.name, email: userTable.email, banned: userTable.banned })
    .from(appAccess)
    .innerJoin(userTable, eq(userTable.id, appAccess.userId))
    .where(and(eq(appAccess.app, app), eq(appAccess.upstreamUserId, upstreamId), eq(appAccess.status, 'active')))
  if (!link) {
    return c.json(
      {
        error: 'not_linked',
        message: `Questo account ${app === 'memories' ? 'Immich' : 'Jellyfin'} non è collegato a un account di casa. Un admin lo collega da accounts.davideghiotto.it/admin, oppure accedi con l'email.`,
      },
      409,
    )
  }
  if (link.banned) throw new HTTPException(403, { message: 'Account disattivato' })

  // 3. The code: pending, fresh, and for a TV of this same app.
  const [code] = await db.select().from(deviceCode).where(eq(deviceCode.userCode, userCode))
  if (!code || code.expiresAt < new Date()) throw new HTTPException(410, { message: 'Codice scaduto o sbagliato: guarda la TV' })
  if (code.status !== 'pending') throw new HTTPException(409, { message: 'Codice già usato: la TV ne mostra uno nuovo' })
  if (!code.clientId || DEVICE_CLIENTS[code.clientId] !== app)
    throw new HTTPException(403, { message: 'Questo codice è di un\'altra app: scansionalo con quella' })
  if (code.userId && code.userId !== link.userId) throw new HTTPException(403, { message: 'Codice già preso da un altro account' })

  if (action === 'check') return c.json({ userCode, clientId: code.clientId, user: { name: link.name, email: link.email } })

  const updated = await db
    .update(deviceCode)
    .set({ status: action === 'approve' ? 'approved' : 'denied', userId: link.userId, updatedAt: new Date() })
    .where(and(eq(deviceCode.id, code.id), eq(deviceCode.status, 'pending')))
    .returning({ id: deviceCode.id })
  if (!updated.length) throw new HTTPException(409, { message: 'Codice già usato: la TV ne mostra uno nuovo' })
  return c.json({ ok: true, status: action === 'approve' ? 'approved' : 'denied' })
})
