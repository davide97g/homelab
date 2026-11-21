import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { db } from '../db/client.ts'
import { type AppId, APPS, invite } from '../db/schema.ts'
import { env } from '../env.ts'
import { provisionAll } from './broker.ts'
import { secret, sha256 } from './crypto.ts'
import { sendInvite } from './mail.ts'

const DAYS = 7

export async function createInvite(input: { email: string; apps: AppId[]; role: 'user' | 'admin' }, by: { id: string; name: string }) {
  const email = input.email.trim().toLowerCase()
  const token = secret(24)
  // A new invite to the same address replaces the old one.
  await db
    .update(invite)
    .set({ revokedAt: new Date() })
    .where(and(eq(invite.email, email), isNull(invite.acceptedAt), isNull(invite.revokedAt)))
  const [row] = await db
    .insert(invite)
    .values({
      email,
      tokenHash: sha256(token),
      apps: input.apps,
      role: input.role,
      expiresAt: new Date(Date.now() + DAYS * 86_400_000),
      createdBy: by.id,
    })
    .returning()
  const url = `${env.APP_URL}/invite/${token}`
  await sendInvite(email, url, input.apps, by.name)
  return { ...row, url }
}

/** What the invite page shows before the code is asked for. */
export async function lookupInvite(token: string) {
  const [row] = await db.select().from(invite).where(eq(invite.tokenHash, sha256(token)))
  if (!row || row.revokedAt) throw new HTTPException(404, { message: 'Invito non valido' })
  if (row.acceptedAt) return { email: row.email, apps: row.apps, state: 'accepted' as const }
  if (row.expiresAt < new Date()) return { email: row.email, apps: row.apps, state: 'expired' as const }
  return { email: row.email, apps: row.apps, state: 'open' as const }
}

/** Runs once the account exists (user.create.after): marks it used, creates the upstream accounts. */
export async function acceptInvite(userId: string, email: string) {
  const [row] = await db
    .update(invite)
    .set({ acceptedAt: new Date() })
    .where(and(eq(invite.email, email.toLowerCase()), isNull(invite.acceptedAt), isNull(invite.revokedAt), gt(invite.expiresAt, new Date())))
    .returning()
  const apps = (row?.apps ?? []).filter((a): a is AppId => (APPS as readonly string[]).includes(a))
  // Upstream is slow and may fail: never block the sign-in on it.
  if (apps.length) void provisionAll(userId, apps)
}

export const listInvites = () => db.select().from(invite).orderBy(desc(invite.createdAt)).limit(200)

export async function revokeInvite(id: string) {
  await db.update(invite).set({ revokedAt: new Date() }).where(and(eq(invite.id, id), isNull(invite.acceptedAt)))
}
