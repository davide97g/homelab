import type {
  AlbumResponseDto,
  AssetBulkUploadCheckResult,
  AssetMediaResponseDto,
  AssetMediaSize,
  AssetResponseDto,
  LoginResponseDto,
  MapMarkerResponseDto,
  MemoryResponseDto,
  MetadataSearchDto,
  PeopleResponseDto,
  PersonResponseDto,
  SearchExploreResponseDto,
  SearchResponseDto,
  SentenceSearchResponseDto,
  SearchSuggestionType,
  ServerVersionResponseDto,
  SmartSearchDto,
  TimeBucketAssetResponseDto,
  TimeBucketsResponseDto,
  TimelineFilter,
  UserAdminResponseDto,
} from './types'

/** Same-origin Immich API root. The host (or Vite in dev) proxies it. */
export const API_BASE = '/api'

const TOKEN_KEY = 'memories.accessToken'

let token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
})()

export function getToken() {
  return token
}
export function setToken(t: string | null) {
  token = t
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode */
  }
  // <img>/<video> cannot send a bearer header: they ride Immich's cookie. A
  // password login gets it from Immich itself (httpOnly, this write is then
  // refused); a token from accounts did not, so it is set here.
  if (t) document.cookie = `immich_access_token=${t}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`
  else document.cookie = 'immich_access_token=; path=/; max-age=0'
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Fired on any 401 so the app can drop back to the login screen. */
export const authEvents = new EventTarget()

type Query = Record<string, string | number | boolean | undefined | null>

function qs(q?: Query): string {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}${qs(opts.query)}`, {
    method,
    credentials: 'same-origin',
    signal: opts.signal,
    headers: {
      Accept: 'application/json',
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 401) authEvents.dispatchEvent(new Event('unauthorized'))
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = (await res.json()) as { message?: string | string[] }
      if (j.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

// ---- URLs for <img>/<video> (cookie-authenticated, same origin) ---------------

export const thumbUrl = (id: string, size: AssetMediaSize = 'thumbnail', cacheKey?: string | null) =>
  `${API_BASE}/assets/${id}/thumbnail?size=${size}${cacheKey ? `&c=${encodeURIComponent(cacheKey)}` : ''}`
export const originalUrl = (id: string) => `${API_BASE}/assets/${id}/original`
export const playbackUrl = (id: string) => `${API_BASE}/assets/${id}/video/playback`
export const personThumbUrl = (id: string, updatedAt?: string) =>
  `${API_BASE}/people/${id}/thumbnail${updatedAt ? `?c=${encodeURIComponent(updatedAt)}` : ''}`

// ---- endpoints ------------------------------------------------------------------

const timelineQuery = (f: TimelineFilter): Query => ({
  visibility: f.visibility ?? (f.albumId || f.personId || f.isTrashed ? undefined : 'timeline'),
  isFavorite: f.isFavorite,
  isTrashed: f.isTrashed,
  albumId: f.albumId,
  personId: f.personId,
  orderBy: f.orderBy,
  withStacked: f.withStacked ?? true,
  order: 'asc',
})

export const api = {
  serverVersion: () => request<ServerVersionResponseDto>('GET', '/server/version'),
  login: (email: string, password: string) => request<LoginResponseDto>('POST', '/auth/login', { body: { email, password } }),
  logout: () => request<unknown>('POST', '/auth/logout'),
  me: () => request<UserAdminResponseDto>('GET', '/users/me'),

  timelineBuckets: (f: TimelineFilter, signal?: AbortSignal) =>
    request<TimeBucketsResponseDto[]>('GET', '/timeline/buckets', { query: timelineQuery(f), signal }),
  timelineBucket: (f: TimelineFilter, timeBucket: string, signal?: AbortSignal) =>
    request<TimeBucketAssetResponseDto>('GET', '/timeline/bucket', { query: { ...timelineQuery(f), timeBucket }, signal }),

  asset: (id: string) => request<AssetResponseDto>('GET', `/assets/${id}`),
  updateAssets: (ids: string[], patch: { isFavorite?: boolean }) => request<void>('PUT', '/assets', { body: { ids, ...patch } }),
  trashAssets: (ids: string[]) => request<void>('DELETE', '/assets', { body: { ids, force: false } }),
  restoreAssets: (ids: string[]) => request<{ count: number }>('POST', '/trash/restore/assets', { body: { ids } }),

  albums: (shared?: boolean) => request<AlbumResponseDto[]>('GET', '/albums', { query: { isShared: shared } }),
  album: (id: string) => request<AlbumResponseDto>('GET', `/albums/${id}`),
  people: () => request<PeopleResponseDto>('GET', '/people', { query: { size: 500 } }),
  person: (id: string) => request<PersonResponseDto>('GET', `/people/${id}`),
  memories: (forDate: string) => request<MemoryResponseDto[]>('GET', '/memories', { query: { for: forDate } }),
  mapMarkers: () => request<MapMarkerResponseDto[]>('GET', '/map/markers'),
  explore: () => request<SearchExploreResponseDto[]>('GET', '/search/explore'),

  smartSearch: (dto: SmartSearchDto) => request<SearchResponseDto>('POST', '/search/smart', { body: { withExif: false, size: 100, ...dto } }),
  /**
   * Search with a sentence via memories-search (LLM plan -> Immich filters). Where that service
   * isn't there (dev against a bare Immich, mock), plain smart search answers instead.
   */
  sentenceSearch: async (query: string, page?: number): Promise<SentenceSearchResponseDto> => {
    try {
      return await request<SentenceSearchResponseDto>('POST', '/memories/search', { body: { query, page: page ?? 1, size: 100 } })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw e
      return api.smartSearch({ query, size: 100, page })
    }
  },
  metadataSearch: (dto: MetadataSearchDto) => request<SearchResponseDto>('POST', '/search/metadata', { body: dto }),
  suggestions: (type: SearchSuggestionType) => request<string[]>('GET', '/search/suggestions', { query: { type } }),

  bulkUploadCheck: (assets: { id: string; checksum: string }[]) =>
    request<{ results: AssetBulkUploadCheckResult[] }>('POST', '/assets/bulk-upload-check', { body: { assets } }),
}

/**
 * Multipart POST /assets with upload progress (fetch has none). v3 takes no
 * deviceAssetId/deviceId.
 */
export function uploadAsset(
  file: File,
  checksum: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AssetMediaResponseDto> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    const modified = new Date(file.lastModified || Date.now()).toISOString()
    form.append('fileCreatedAt', modified)
    form.append('fileModifiedAt', modified)
    form.append('filename', file.name)
    form.append('isFavorite', 'false')
    form.append('assetData', file, file.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/assets`)
    xhr.withCredentials = true
    xhr.setRequestHeader('x-immich-checksum', checksum)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      if (xhr.status === 401) authEvents.dispatchEvent(new Event('unauthorized'))
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as AssetMediaResponseDto)
        } catch {
          reject(new ApiError(xhr.status, 'Bad response'))
        }
      } else {
        let msg = xhr.statusText || `HTTP ${xhr.status}`
        if (xhr.status === 413) msg = 'Too large for the public URL (100 MB cap) — upload on the LAN'
        try {
          const j = JSON.parse(xhr.responseText) as { message?: string }
          if (j.message) msg = j.message
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, msg))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.onabort = () => reject(new ApiError(0, 'Cancelled'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(form)
  })
}
