export class UpstreamError extends Error {
  constructor(
    readonly app: string,
    readonly status: number,
    message: string,
  ) {
    super(`${app}: ${status} ${message}`)
  }
}

export async function call<T>(app: string, url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new UpstreamError(app, res.status, text.slice(0, 200) || res.statusText)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? await res.json() : await res.text()) as T
}
