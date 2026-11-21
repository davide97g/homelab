import { env } from '../env.ts'
import { call } from './http.ts'

/** Immich (3.x) through an admin API key, same idea as jellyfin.ts. */

export type ImmichUser = { id: string; email: string; name: string; isAdmin: boolean; deletedAt?: string | null }

export const immichEnabled = () => Boolean(env.IMMICH_URL && env.IMMICH_API_KEY)

const base = () => {
  if (!env.IMMICH_URL || !env.IMMICH_API_KEY) throw new Error('Immich non configurato')
  return `${env.IMMICH_URL.replace(/\/+$/, '')}/api`
}

function admin(path: string, init: RequestInit = {}) {
  return call<unknown>('immich', `${base()}${path}`, {
    ...init,
    headers: { 'x-api-key': env.IMMICH_API_KEY as string, 'Content-Type': 'application/json', ...init.headers },
  })
}

export const listUsers = () => admin('/admin/users') as Promise<ImmichUser[]>

export async function createUser(email: string, name: string, password: string) {
  return (await admin('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, name, password, shouldChangePassword: false, notify: false }),
  })) as ImmichUser
}

export async function setPassword(userId: string, password: string) {
  await admin(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ password, shouldChangePassword: false }) })
}

export async function signIn(email: string, password: string, deviceName: string) {
  const r = (await call('immich', `${base()}/auth/login`, {
    method: 'POST',
    // Immich names the session after the user agent.
    headers: { 'Content-Type': 'application/json', 'User-Agent': deviceName },
    body: JSON.stringify({ email, password }),
  })) as { accessToken: string; userId: string }
  return { accessToken: r.accessToken, userId: r.userId }
}

/** Logs that one session out, with its own token. */
export async function signOut(accessToken: string) {
  await call('immich', `${base()}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
}

/** Who a user token belongs to (the iPhone's own Immich session). */
export async function whoAmI(accessToken: string) {
  return (await call('immich', `${base()}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } })) as {
    id: string
    email: string
    name: string
  }
}
