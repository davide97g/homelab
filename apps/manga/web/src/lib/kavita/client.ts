import type { User } from './types'

// Everything goes to `/api` on our own origin (Vite proxy in dev, nginx in the
// container). Never an absolute Kavita URL.
const BASE = '/api'
const STORAGE_KEY = 'yomu.user'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function storeUser(user: User | null) {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode: the session lives until the tab closes, which is fine.
  }
}

let current: User | null = loadUser()
let onSignedOut: () => void = () => {}

export function setSession(user: User | null) {
  current = user
  storeUser(user)
}

export function getSession() {
  return current
}

export function onSessionLost(fn: () => void) {
  onSignedOut = fn
}

// The key Kavita accepts as `?apiKey=` on image URLs, where no header can go.
export function imageKey() {
  return current?.authKeys.find((k) => k.name === 'image-only')?.key ?? ''
}

let refreshing: Promise<boolean> | null = null

async function refresh(): Promise<boolean> {
  if (!current?.refreshToken) return false
  refreshing ??= fetch(`${BASE}/account/refresh-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: current.token, refreshToken: current.refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok || !current) return false
      const t = (await res.json()) as { token: string; refreshToken: string }
      setSession({ ...current, token: t.token, refreshToken: t.refreshToken })
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

// `base` is `/api` (Kavita) unless it says otherwise: the scripts service
// lives at `/script` on the same origin and takes the same Bearer token.
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number | boolean>; base?: string } = {},
  retried = false,
): Promise<T> {
  const qs = init.query
    ? '?' + new URLSearchParams(Object.entries(init.query).map(([k, v]) => [k, String(v)]))
    : ''
  const res = await fetch(`${init.base ?? BASE}${path}${qs}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(current ? { authorization: `Bearer ${current.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  if (res.status === 401 && current && !retried) {
    if (await refresh()) return api<T>(path, init, true)
    setSession(null)
    onSignedOut()
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HttpError(res.status, text.replace(/^"|"$/g, '') || res.statusText)
  }
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) return undefined as T
  return (await res.json()) as T
}
