import { ACCOUNTS_URL } from '../accounts'

/**
 * Discover talks to accounts, not to Seerr: accounts checks the Jellyfin token
 * this browser already holds, maps it to the same person's Seerr user and asks
 * Seerr on their behalf. No Seerr sign-in, no Seerr key in the browser.
 */
export class DiscoverError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function discoverFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ACCOUNTS_URL}/api/discover/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new DiscoverError(res.status, body?.error ?? `Discover answered ${res.status}`)
  return body as T
}

/** TMDB serves Seerr's artwork; sizes are TMDB's fixed widths. */
export function tmdbImage(path: string | null | undefined, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined
}
