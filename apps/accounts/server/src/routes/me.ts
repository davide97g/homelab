import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.ts'
import { appAccess, deviceGrant } from '../db/schema.ts'
import { revokeGrant } from '../lib/broker.ts'
import { type AuthedEnv, requireUser } from '../context.ts'

export const meRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  .get('/', async (c) => {
    const u = c.get('user')
    const [apps, devices] = await Promise.all([
      db.select({ app: appAccess.app, status: appAccess.status }).from(appAccess).where(eq(appAccess.userId, u.id)),
      db
        .select({
          id: deviceGrant.id,
          app: deviceGrant.app,
          deviceName: deviceGrant.deviceName,
          lastSeenAt: deviceGrant.lastSeenAt,
          createdAt: deviceGrant.createdAt,
        })
        .from(deviceGrant)
        .where(and(eq(deviceGrant.userId, u.id), isNull(deviceGrant.revokedAt)))
        .orderBy(desc(deviceGrant.lastSeenAt)),
    ])
    return c.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role }, apps, devices })
  })
  .delete('/devices/:id', async (c) => {
    await revokeGrant(c.req.param('id'), c.get('user').id)
    return c.json({ ok: true })
  })
