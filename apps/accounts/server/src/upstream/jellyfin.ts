import { env } from '../env.ts'
import { call } from './http.ts'

/**
 * Jellyfin (12.x) through its admin API key. Jellyfin has no way for an admin
 * to mint a token for someone else, so the broker signs in as the user with a
 * password only it knows.
 */

export type JellyfinUser = { Id: string; Name: string; Policy?: Record<string, unknown> & { IsAdministrator?: boolean; IsDisabled?: boolean } }

export const jellyfinEnabled = () => Boolean(env.JELLYFIN_URL && env.JELLYFIN_API_KEY)

const base = () => {
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) throw new Error('Jellyfin non configurato')
  return env.JELLYFIN_URL.replace(/\/+$/, '')
}
const quote = (s: string) => s.replace(/["\\,]/g, '_')

function admin(path: string, init: RequestInit = {}) {
  return call<unknown>('jellyfin', `${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export const listUsers = () => admin('/Users') as Promise<JellyfinUser[]>

export const getUser = (id: string) => admin(`/Users/${id}`) as Promise<JellyfinUser>

export async function createUser(name: string, password: string) {
  return (await admin('/Users/New', { method: 'POST', body: JSON.stringify({ Name: name, Password: password }) })) as JellyfinUser
}

export async function setPassword(userId: string, password: string) {
  // An admin key skips the current-password check.
  await admin(`/Users/Password?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
    body: JSON.stringify({ NewPw: password, ResetPassword: false }),
  })
}

export async function setDisabled(userId: string, disabled: boolean) {
  const u = await getUser(userId)
  if (!u.Policy) throw new Error('Jellyfin user without policy')
  await admin(`/Users/${userId}/Policy`, { method: 'POST', body: JSON.stringify({ ...u.Policy, IsDisabled: disabled }) })
}

export type Device = { id: string; name: string; client: string; version: string }

/**
 * Signs in as the user from the client's own device identity, so the token,
 * "Continue Watching" and the dashboard's device list all belong to that TV or
 * browser, not to this service.
 */
export async function signIn(login: string, password: string, device: Device) {
  const auth = `MediaBrowser Client="${quote(device.client)}", Device="${quote(device.name)}", DeviceId="${quote(device.id)}", Version="${quote(device.version)}"`
  const r = (await call('jellyfin', `${base()}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Username: login, Pw: password }),
  })) as { AccessToken: string; User: { Id: string } }
  return { accessToken: r.AccessToken, userId: r.User.Id }
}

/** Kills every token Jellyfin issued to that device id. */
export async function deleteDevice(deviceId: string) {
  await admin(`/Devices?id=${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
}
