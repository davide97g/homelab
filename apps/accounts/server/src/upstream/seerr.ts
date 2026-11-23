import { env } from '../env.ts'
import { call } from './http.ts'

/**
 * Seerr through its API key. With `X-API-User` the key acts as that Seerr user, so
 * every permission, quota and auto-approve rule Seerr has for them still applies:
 * this service only decides *who* is asking, never what they may do.
 */

export const seerrEnabled = () => Boolean(env.SEERR_URL && env.SEERR_API_KEY)

const base = () => {
  if (!env.SEERR_URL || !env.SEERR_API_KEY) throw new Error('Seerr non configurato')
  return `${env.SEERR_URL.replace(/\/+$/, '')}/api/v1`
}

export type SeerrUser = { id: number; displayName: string; permissions: number; jellyfinUserId: string | null }

/** Seerr's Permission enum, the bits Discover cares about. */
export const Permission = {
  ADMIN: 2,
  MANAGE_REQUESTS: 16,
  REQUEST: 32,
  AUTO_APPROVE: 128,
  AUTO_APPROVE_MOVIE: 256,
  AUTO_APPROVE_TV: 512,
  REQUEST_MOVIE: 262144,
  REQUEST_TV: 524288,
} as const

const has = (perms: number, ...bits: number[]) =>
  (perms & Permission.ADMIN) !== 0 || bits.some((b) => (perms & b) !== 0)

export const canRequest = (perms: number, kind: 'movie' | 'tv') =>
  has(perms, Permission.REQUEST, kind === 'movie' ? Permission.REQUEST_MOVIE : Permission.REQUEST_TV)

export const autoApproved = (perms: number, kind: 'movie' | 'tv') =>
  has(perms, Permission.AUTO_APPROVE, kind === 'movie' ? Permission.AUTO_APPROVE_MOVIE : Permission.AUTO_APPROVE_TV)

function admin<T>(path: string, init: RequestInit = {}) {
  return call<T>('seerr', `${base()}${path}`, {
    ...init,
    headers: { 'X-Api-Key': env.SEERR_API_KEY ?? '', 'Content-Type': 'application/json', ...init.headers },
  })
}

/** Runs one of Seerr's scheduled jobs now, e.g. `jellyfin-recently-added-scan`. */
export async function runJob(id: string) {
  await admin<unknown>(`/settings/jobs/${encodeURIComponent(id)}/run`, { method: 'POST' })
}

/** The Seerr user linked to a Jellyfin user, or null when Seerr has never seen them. */
export async function userByJellyfinId(jellyfinUserId: string): Promise<SeerrUser | null> {
  const res = await fetch(`${base()}/user/jellyfin/${encodeURIComponent(jellyfinUserId)}`, {
    headers: { 'X-Api-Key': env.SEERR_API_KEY ?? '' },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`seerr: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return (await res.json()) as SeerrUser
}

/** Creates the Seerr user from Jellyfin, with Seerr's default permissions. */
export async function importFromJellyfin(jellyfinUserId: string) {
  await admin<unknown>('/user/import-from-jellyfin', {
    method: 'POST',
    body: JSON.stringify({ jellyfinUserIds: [jellyfinUserId] }),
  })
}

/**
 * One call as `userId`, answered as Seerr answered it: status and JSON body both pass
 * through, so a 403 for a missing permission or a 409 for a duplicate request reaches
 * the client unchanged.
 */
export async function asUser(userId: number, path: string, init: RequestInit = {}) {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'X-Api-Key': env.SEERR_API_KEY ?? '',
      'X-API-User': String(userId),
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })
  const type = res.headers.get('content-type') ?? ''
  const body: unknown = res.status === 204 ? null : type.includes('json') ? await res.json().catch(() => null) : await res.text()
  return { status: res.status, body }
}
