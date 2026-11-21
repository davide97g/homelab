export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error_description ?? data?.error ?? data?.message ?? `Errore ${res.status}`
    throw new ApiError(res.status, typeof msg === 'string' ? msg : `Errore ${res.status}`)
  }
  return data as T
}

export type AppId = 'cinema' | 'memories'
export const APP_LABEL: Record<AppId, string> = { cinema: 'Cinema', memories: 'Memories' }
export const CLIENT_LABEL: Record<string, string> = { 'cinema-tv': 'Cinema sulla TV', 'memories-tv': 'Memories sulla TV' }

export type Me = {
  user: { id: string; email: string; name: string; role: string }
  apps: { app: AppId; status: string }[]
  devices: { id: string; app: AppId; deviceName: string; lastSeenAt: string; createdAt: string }[]
}

/** Where to send someone back after signing in: only our own domains. */
export function safeNext(next: string | null): string | null {
  if (!next) return null
  try {
    const u = new URL(next, location.origin)
    const ok =
      u.origin === location.origin ||
      (u.protocol === 'https:' && (u.hostname === 'davideghiotto.it' || u.hostname.endsWith('.davideghiotto.it'))) ||
      u.hostname === 'localhost'
    return ok ? u.toString() : null
  } catch {
    return null
  }
}

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 90) return 'adesso'
  if (s < 3600) return `${Math.round(s / 60)} min fa`
  if (s < 86400) return `${Math.round(s / 3600)} h fa`
  return `${Math.round(s / 86400)} g fa`
}
