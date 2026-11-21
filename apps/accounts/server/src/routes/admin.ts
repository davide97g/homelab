import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db/client.ts'
import { type AppId, APPS, appAccess, deviceGrant, session as sessionTable, user as userTable } from '../db/schema.ts'
import { provision, revokeApp, revokeGrant } from '../lib/broker.ts'
import { createInvite, listInvites, revokeInvite } from '../lib/invites.ts'
import { setupChecks, suggestLinks } from '../lib/setup.ts'
import * as immich from '../upstream/immich.ts'
import * as jellyfin from '../upstream/jellyfin.ts'
import { type AuthedEnv, requireAdmin } from '../context.ts'

const appId = z.enum(APPS)

function parseApp(v: string): AppId {
  const r = appId.safeParse(v)
  if (!r.success) throw new HTTPException(404, { message: 'App sconosciuta' })
  return r.data
}

async function findUser(id: string) {
  const [u] = await db.select().from(userTable).where(eq(userTable.id, id))
  if (!u) throw new HTTPException(404, { message: 'Utente non trovato' })
  return u
}

/**
 * Admin only. Users, roles and bans go through Better Auth's own admin
 * endpoints (/api/auth/admin/*); this is everything Better Auth does not know:
 * invites, per-app access, devices.
 */
export const adminRoutes = new Hono<AuthedEnv>()
  .use(requireAdmin)
  .get('/users', async (c) => {
    const [users, access, grants] = await Promise.all([
      db.select().from(userTable).orderBy(desc(userTable.createdAt)),
      db
        .select({
          userId: appAccess.userId,
          app: appAccess.app,
          status: appAccess.status,
          upstreamLogin: appAccess.upstreamLogin,
          lastError: appAccess.lastError,
        })
        .from(appAccess),
      db
        .select({
          id: deviceGrant.id,
          userId: deviceGrant.userId,
          app: deviceGrant.app,
          deviceName: deviceGrant.deviceName,
          lastSeenAt: deviceGrant.lastSeenAt,
        })
        .from(deviceGrant)
        .where(isNull(deviceGrant.revokedAt))
        .orderBy(desc(deviceGrant.lastSeenAt)),
    ])
    // Rows stuck in error: guess the upstream account to link, so the fix is one click.
    const stuck = access
      .filter((a) => a.status === 'error')
      .map((a) => ({ userId: a.userId, app: a.app, email: users.find((u) => u.id === a.userId)?.email ?? '' }))
    const suggestions = await suggestLinks(stuck).catch(() => new Map())
    return c.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        banned: u.banned ?? false,
        createdAt: u.createdAt,
        apps: access
          .filter((a) => a.userId === u.id)
          .map((a) => ({ ...a, suggest: suggestions.get(`${u.id}:${a.app}`) ?? null })),
        devices: grants.filter((g) => g.userId === u.id),
      })),
    )
  })
  /** The Setup tab: every moving part, checked live, with its fix. */
  .get('/setup', async (c) => c.json(await setupChecks()))
  .get('/invites', async (c) => c.json(await listInvites()))
  .post('/invites', async (c) => {
    const body = z
      .object({ email: z.email(), apps: z.array(appId).default([]), role: z.enum(['user', 'admin']).default('user') })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) throw new HTTPException(400, { message: 'Email non valida' })
    const [existing] = await db.select().from(userTable).where(eq(userTable.email, body.data.email.toLowerCase()))
    if (existing) throw new HTTPException(409, { message: 'Ha già un account: dagli le app dalla sua scheda' })
    const u = c.get('user')
    const inv = await createInvite(body.data, { id: u.id, name: u.name })
    // The link comes back too: handy to send it by hand when mail is not set up.
    return c.json({ id: inv.id, url: inv.url })
  })
  .delete('/invites/:id', async (c) => {
    await revokeInvite(c.req.param('id'))
    return c.json({ ok: true })
  })
  /** Grant an app: create the upstream account, or take over `linkTo` (an existing upstream user id). */
  .post('/users/:id/apps/:app', async (c) => {
    const app = parseApp(c.req.param('app'))
    const u = await findUser(c.req.param('id'))
    const body = z.object({ linkTo: z.string().optional() }).parse(await c.req.json().catch(() => ({})))
    try {
      await provision(u, app, body.linkTo)
    } catch (err) {
      throw new HTTPException(502, { message: err instanceof Error ? err.message : 'Errore upstream' })
    }
    return c.json({ ok: true })
  })
  .delete('/users/:id/apps/:app', async (c) => {
    await revokeApp(c.req.param('id'), parseApp(c.req.param('app')))
    return c.json({ ok: true })
  })
  /**
   * Better Auth's ban drops its own sessions, not the Jellyfin/Immich tokens
   * the broker handed out. This does both, and unban gives sign-in back
   * (devices sign in again).
   */
  .post('/users/:id/ban', async (c) => {
    const u = await findUser(c.req.param('id'))
    if (u.id === c.get('user').id) throw new HTTPException(400, { message: 'Non puoi disattivare te stesso' })
    const grants = await db
      .select({ id: deviceGrant.id })
      .from(deviceGrant)
      .where(and(eq(deviceGrant.userId, u.id), isNull(deviceGrant.revokedAt)))
    for (const g of grants) await revokeGrant(g.id)
    await db.update(userTable).set({ banned: true }).where(eq(userTable.id, u.id))
    await db.delete(sessionTable).where(eq(sessionTable.userId, u.id))
    return c.json({ ok: true })
  })
  .post('/users/:id/unban', async (c) => {
    await db.update(userTable).set({ banned: false, banReason: null, banExpires: null }).where(eq(userTable.id, c.req.param('id')))
    return c.json({ ok: true })
  })
  .post('/users/:id/role', async (c) => {
    const { role } = z.object({ role: z.enum(['user', 'admin']) }).parse(await c.req.json())
    if (c.req.param('id') === c.get('user').id) throw new HTTPException(400, { message: 'Non puoi cambiare il tuo ruolo' })
    await db.update(userTable).set({ role }).where(eq(userTable.id, c.req.param('id')))
    return c.json({ ok: true })
  })
  .delete('/devices/:id', async (c) => {
    await revokeGrant(c.req.param('id'))
    return c.json({ ok: true })
  })
  /** Upstream accounts nobody here owns yet: the candidates for "link existing". */
  .get('/upstream/:app/users', async (c) => {
    const app = parseApp(c.req.param('app'))
    if (app === 'cinema' ? !jellyfin.jellyfinEnabled() : !immich.immichEnabled())
      throw new HTTPException(400, { message: `${app === 'cinema' ? 'Jellyfin' : 'Immich'} non è configurato qui: guarda il tab Setup.` })
    const owned = new Set(
      (await db.select({ id: appAccess.upstreamUserId }).from(appAccess).where(and(eq(appAccess.app, app)))).map((r) => r.id),
    )
    if (app === 'cinema') {
      const users = await jellyfin.listUsers()
      return c.json(
        users
          .filter((u) => !owned.has(u.Id))
          .map((u) => ({ id: u.Id, login: u.Name, admin: Boolean(u.Policy?.IsAdministrator) })),
      )
    }
    const users = await immich.listUsers()
    return c.json(users.filter((u) => !owned.has(u.id) && !u.deletedAt).map((u) => ({ id: u.id, login: u.email, admin: u.isAdmin })))
  })
