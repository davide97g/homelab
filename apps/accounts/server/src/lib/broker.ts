import { and, eq, isNull } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { env } from '../env.ts'
import { db } from '../db/client.ts'
import { type AppId, appAccess, deviceGrant, session as sessionTable, user as userTable } from '../db/schema.ts'
import * as immich from '../upstream/immich.ts'
import * as jellyfin from '../upstream/jellyfin.ts'
import { open, seal, secret } from './crypto.ts'

type User = { id: string; email: string; name: string }

/** "Mario Rossi" <mario.rossi@x.it> -> "mario.rossi", or "mario.rossi2" when taken. */
function jellyfinName(u: User, taken: Set<string>) {
  const stem = (u.email.split('@')[0] ?? 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user'
  let name = stem
  for (let i = 2; taken.has(name); i++) name = `${stem}${i}`
  return name
}

async function upsertAccess(userId: string, app: AppId, values: Partial<typeof appAccess.$inferInsert>) {
  await db
    .insert(appAccess)
    .values({ userId, app, ...values })
    .onConflictDoUpdate({ target: [appAccess.userId, appAccess.app], set: values })
}

/**
 * Gives a user an account in `app`. With `linkTo`, takes over an account that
 * already exists upstream (resets its password: the old one stops working).
 * Otherwise creates one. Errors are kept on the row so the admin page shows them.
 */
export async function provision(u: User, app: AppId, linkTo?: string) {
  const password = secret(32)
  try {
    if (app === 'cinema') {
      const users = await jellyfin.listUsers()
      let target = linkTo ? users.find((x) => x.Id === linkTo) : undefined
      if (linkTo && !target) throw new Error('Utente Jellyfin non trovato')
      if (target) {
        await jellyfin.setPassword(target.Id, password)
        if (target.Policy?.IsDisabled) await jellyfin.setDisabled(target.Id, false)
      } else {
        target = await jellyfin.createUser(jellyfinName(u, new Set(users.map((x) => x.Name.toLowerCase()))), password)
      }
      await upsertAccess(u.id, app, {
        upstreamUserId: target.Id,
        upstreamLogin: target.Name,
        passwordEnc: seal(password),
        status: 'active',
        lastError: null,
      })
    } else {
      const users = await immich.listUsers()
      let target = linkTo
        ? users.find((x) => x.id === linkTo)
        : users.find((x) => x.email.toLowerCase() === u.email.toLowerCase())
      if (linkTo && !target) throw new Error('Utente Immich non trovato')
      // Same email already in Immich without an explicit link: an admin decides, not us.
      if (target && !linkTo) throw new Error(`Esiste già un utente Immich con ${u.email}: collegalo dalla pagina admin`)
      if (target) await immich.setPassword(target.id, password)
      else target = await immich.createUser(u.email, u.name, password)
      await upsertAccess(u.id, app, {
        upstreamUserId: target.id,
        upstreamLogin: target.email,
        passwordEnc: seal(password),
        status: 'active',
        lastError: null,
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[broker] provision ${app} for ${u.email} failed: ${message}`)
    await upsertAccess(u.id, app, { status: 'error', lastError: message })
    throw err
  }
}

export type DeviceInfo = { id: string; name: string; client: string; version: string }

/**
 * The heart of it: a signed-in user asks for `app`, gets the app's own token.
 * The client keeps that token and talks to Jellyfin/Immich directly from then
 * on, so this service going down signs nobody out.
 */
export async function issueToken(u: User, sessionId: string, app: AppId, device: DeviceInfo) {
  const [access] = await db
    .select()
    .from(appAccess)
    .where(and(eq(appAccess.userId, u.id), eq(appAccess.app, app)))
  if (!access) throw new HTTPException(403, { message: `Non hai accesso a ${app}` })
  if (access.status !== 'active' || !access.upstreamLogin || !access.passwordEnc)
    throw new HTTPException(409, { message: `Account ${app} non pronto: chiedi a un admin` })

  const password = open(access.passwordEnc)
  let result: { accessToken: string; userId: string; serverUrl: string }
  if (app === 'cinema') {
    const r = await jellyfin.signIn(access.upstreamLogin, password, device)
    result = { ...r, serverUrl: env.JELLYFIN_PUBLIC_URL }
  } else {
    const r = await immich.signIn(access.upstreamLogin, password, `${device.client} ${device.name}`)
    result = { ...r, serverUrl: env.IMMICH_PUBLIC_URL }
  }

  const values = {
    deviceName: device.name,
    sessionId,
    upstreamTokenEnc: seal(result.accessToken),
    lastSeenAt: new Date(),
    revokedAt: null,
  }
  await db
    .insert(deviceGrant)
    .values({ userId: u.id, app, deviceId: device.id, ...values })
    .onConflictDoUpdate({ target: [deviceGrant.userId, deviceGrant.app, deviceGrant.deviceId], set: values })
  return result
}

/** Signs one device out everywhere: its Better Auth session and its upstream token. */
export async function revokeGrant(grantId: string, byUserId?: string) {
  const [g] = await db
    .select()
    .from(deviceGrant)
    .where(and(eq(deviceGrant.id, grantId), isNull(deviceGrant.revokedAt), byUserId ? eq(deviceGrant.userId, byUserId) : undefined))
  if (!g) throw new HTTPException(404, { message: 'Dispositivo non trovato' })
  try {
    if (g.app === 'cinema') await jellyfin.deleteDevice(g.deviceId)
    else if (g.upstreamTokenEnc) await immich.signOut(open(g.upstreamTokenEnc))
  } catch (err) {
    // A token already gone upstream is the outcome we wanted.
    console.warn(`[broker] upstream revoke ${g.app}/${g.deviceId}: ${err instanceof Error ? err.message : err}`)
  }
  if (g.sessionId) await db.delete(sessionTable).where(eq(sessionTable.id, g.sessionId))
  await db.update(deviceGrant).set({ revokedAt: new Date(), upstreamTokenEnc: null }).where(eq(deviceGrant.id, g.id))
}

/** Takes `app` away: every device out, upstream account locked, row gone. */
export async function revokeApp(userId: string, app: AppId) {
  const grants = await db
    .select({ id: deviceGrant.id })
    .from(deviceGrant)
    .where(and(eq(deviceGrant.userId, userId), eq(deviceGrant.app, app), isNull(deviceGrant.revokedAt)))
  for (const g of grants) await revokeGrant(g.id)
  const [access] = await db
    .select()
    .from(appAccess)
    .where(and(eq(appAccess.userId, userId), eq(appAccess.app, app)))
  if (access?.upstreamUserId) {
    try {
      if (app === 'cinema') await jellyfin.setDisabled(access.upstreamUserId, true)
      // Immich has no "disabled": a password nobody knows is the lock.
      else await immich.setPassword(access.upstreamUserId, secret(32))
    } catch (err) {
      console.warn(`[broker] upstream lock ${app}: ${err instanceof Error ? err.message : err}`)
    }
  }
  await db.delete(appAccess).where(and(eq(appAccess.userId, userId), eq(appAccess.app, app)))
}

/** Grants from an invite, after the account exists. Failures stay on the row. */
export async function provisionAll(userId: string, apps: AppId[]) {
  const [u] = await db.select().from(userTable).where(eq(userTable.id, userId))
  if (!u) return
  for (const app of apps) await provision(u, app).catch(() => {})
}
