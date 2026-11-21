// Dev-only fake Immich v3.4.0 API, mounted at /api by `bun run dev:mock`.
// Only the endpoints the web client calls are implemented; shapes follow
// spec/immich-openapi-v3.4.0.json.
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  ALBUMS,
  CITIES,
  MONTHS,
  PEOPLE,
  allAssets,
  assetId,
  avatarSvg,
  edits,
  getAsset,
  hash32,
  inAlbum,
  monthAssets,
  parseAssetId,
  sceneSvg,
  thumbhashFor,
  type MockAsset,
} from './data.ts'

const USER = {
  id: '0000eeee-0000-4000-8000-000000000001',
  email: 'demo@memories.local',
  name: 'Demo',
  avatarColor: 'blue',
  profileImagePath: '',
  profileChangedAt: '2024-01-01T00:00:00.000Z',
}

const iso = (d: Date) => d.toISOString()
const bucketKey = (month: number) => `${Math.floor(month / 100)}-${String(month % 100).padStart(2, '0')}-01T00:00:00.000Z`

function send(res: ServerResponse, status: number, body?: unknown, type = 'application/json') {
  res.statusCode = status
  if (body === undefined) return res.end()
  res.setHeader('Content-Type', type)
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}
async function readJson<T>(req: IncomingMessage): Promise<T> {
  const b = await readBody(req)
  return (b.length ? JSON.parse(b.toString('utf8')) : {}) as T
}

// ---- filtering --------------------------------------------------------------

interface TimelineQuery {
  isFavorite?: boolean
  isTrashed?: boolean
  visibility?: string
  albumId?: string
  personId?: string
  order: 'asc' | 'desc'
}

function parseTimelineQuery(q: URLSearchParams): TimelineQuery {
  const b = (k: string) => (q.has(k) ? q.get(k) === 'true' : undefined)
  return {
    isFavorite: b('isFavorite'),
    isTrashed: b('isTrashed'),
    visibility: q.get('visibility') ?? undefined,
    albumId: q.get('albumId') ?? undefined,
    personId: q.get('personId') ?? undefined,
    order: q.get('order') === 'asc' ? 'asc' : 'desc',
  }
}

function matches(a: MockAsset, q: TimelineQuery): boolean {
  if (q.isTrashed) return a.trashed
  if (a.trashed) return false
  if (q.visibility && a.visibility !== q.visibility) return false
  if (!q.visibility && !q.albumId && a.visibility !== 'timeline') return false
  if (q.isFavorite !== undefined && a.favorite !== q.isFavorite) return false
  if (q.albumId) {
    const al = ALBUMS.find((x) => x.id === q.albumId)
    if (!al || !inAlbum(al, a)) return false
  }
  if (q.personId) {
    const p = PEOPLE.find((x) => x.id === q.personId)
    if (!p || !a.people.includes(p.index)) return false
  }
  return true
}

// ---- DTOs -------------------------------------------------------------------

function assetDto(a: MockAsset) {
  const c = CITIES[a.city]
  return {
    id: a.id,
    checksum: Buffer.from(a.id).toString('base64').slice(0, 28),
    createdAt: iso(a.takenAt),
    fileCreatedAt: iso(a.takenAt),
    fileModifiedAt: iso(a.takenAt),
    localDateTime: iso(new Date(a.takenAt.getTime() + 3600_000)),
    updatedAt: iso(a.takenAt),
    duration: a.duration === null ? null : `0:${String(Math.floor(a.duration / 60000)).padStart(2, '0')}:${String(Math.floor((a.duration / 1000) % 60)).padStart(2, '0')}.000000`,
    hasMetadata: true,
    width: a.ratio >= 1 ? 4032 : Math.round(4032 * a.ratio),
    height: a.ratio >= 1 ? Math.round(4032 / a.ratio) : 4032,
    isArchived: a.visibility === 'archive',
    isEdited: false,
    isFavorite: a.favorite,
    isOffline: false,
    isTrashed: a.trashed,
    livePhotoVideoId: a.live,
    originalFileName: `IMG_${String(a.seed % 10000).padStart(4, '0')}.${a.isImage ? 'HEIC' : 'MOV'}`,
    originalMimeType: a.isImage ? 'image/heic' : 'video/quicktime',
    originalPath: '/mock',
    ownerId: USER.id,
    thumbhash: thumbhashFor(a.seed, a.ratio),
    type: a.isImage ? 'IMAGE' : 'VIDEO',
    visibility: a.visibility,
    people: a.people.map((i) => personDto(i)),
    exifInfo: {
      city: c.city,
      state: c.state,
      country: c.country,
      latitude: c.lat + ((a.seed % 1000) - 500) / 20000,
      longitude: c.lon + (((a.seed >>> 10) % 1000) - 500) / 20000,
      dateTimeOriginal: iso(a.takenAt),
      description: a.seed % 9 === 0 ? 'A good day.' : '',
      exifImageWidth: a.ratio >= 1 ? 4032 : Math.round(4032 * a.ratio),
      exifImageHeight: a.ratio >= 1 ? Math.round(4032 / a.ratio) : 4032,
      exposureTime: ['1/120', '1/250', '1/60', '1/1000'][a.seed % 4],
      fNumber: [1.8, 2.8, 4, 1.6][a.seed % 4],
      focalLength: [6.8, 24, 35, 4.2][a.seed % 4],
      iso: [50, 100, 200, 640, 1600][a.seed % 5],
      fileSizeInByte: 1_000_000 + (a.seed % 5_000_000),
      make: a.make,
      model: a.model,
      lensModel: a.lens,
      timeZone: 'Europe/Rome',
    },
  }
}

function personDto(i: number) {
  const p = PEOPLE[i]
  return {
    id: p.id,
    name: p.name,
    birthDate: null,
    isHidden: false,
    isFavorite: i < 3,
    thumbnailPath: '/mock',
    otherPeople: [],
    sharedBy: [],
    sharedWith: [],
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

function albumDto(al: (typeof ALBUMS)[number]) {
  let count = 0
  let first: MockAsset | null = null
  let last: MockAsset | null = null
  for (const mo of MONTHS) {
    if (mo.key < al.from || mo.key > al.to) continue
    for (const a of monthAssets(mo.key)) {
      if (!inAlbum(al, a) || a.trashed) continue
      count++
      first ??= a
      last = a
    }
  }
  return {
    id: al.id,
    albumName: al.name,
    description: al.description,
    albumThumbnailAssetId: first?.id ?? null,
    albumUsers: al.shared ? [{ role: 'editor', user: { ...USER, id: 'other', name: 'Giulia', email: 'g@x' } }] : [],
    assetCount: count,
    createdAt: first ? iso(first.takenAt) : '2024-01-01T00:00:00.000Z',
    updatedAt: last ? iso(last.takenAt) : '2024-01-01T00:00:00.000Z',
    startDate: first ? iso(first.takenAt) : undefined,
    endDate: last ? iso(last.takenAt) : undefined,
    hasSharedLink: false,
    isActivityEnabled: false,
    shared: al.shared,
    order: 'desc',
  }
}

function columnar(list: MockAsset[]) {
  return {
    id: list.map((a) => a.id),
    ownerId: list.map(() => USER.id),
    ratio: list.map((a) => a.ratio),
    thumbhash: list.map((a) => thumbhashFor(a.seed, a.ratio)),
    fileCreatedAt: list.map((a) => iso(a.takenAt)),
    createdAt: list.map((a) => iso(a.takenAt)),
    localOffsetHours: list.map(() => 1),
    isImage: list.map((a) => a.isImage),
    isFavorite: list.map((a) => a.favorite),
    isTrashed: list.map((a) => a.trashed),
    duration: list.map((a) => a.duration),
    livePhotoVideoId: list.map((a) => a.live),
    projectionType: list.map(() => null),
    visibility: list.map((a) => a.visibility),
    city: list.map((a) => CITIES[a.city].city),
    country: list.map((a) => CITIES[a.city].country),
    stack: list.map(() => null),
  }
}

// ---- searches -----------------------------------------------------------------

function sampleAssets(seedText: string, n: number): MockAsset[] {
  const out: MockAsset[] = []
  const seen = new Set<string>()
  for (let i = 0; out.length < n && i < n * 4; i++) {
    const mo = MONTHS[hash32(seedText, i, 'm') % MONTHS.length]
    const list = monthAssets(mo.key)
    const a = list[hash32(seedText, i, 'i') % list.length]
    if (a.visibility !== 'timeline' || a.trashed || seen.has(a.id)) continue
    seen.add(a.id)
    out.push(a)
  }
  return out
}

interface MetadataBody {
  size?: number
  cursor?: string
  filter?: { type?: { eq?: string }; isMotion?: { eq?: boolean }; city?: { eq?: string }; isFavorite?: { eq?: boolean } }
}

function metadataSearch(body: MetadataBody) {
  const size = body.size ?? 250
  const offset = body.cursor ? Number(body.cursor) : 0
  const f = body.filter ?? {}
  const hits: MockAsset[] = []
  // newest first, like the server's default
  for (let m = MONTHS.length - 1; m >= 0; m--) {
    const list = monthAssets(MONTHS[m].key)
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i]
      if (a.trashed || a.visibility !== 'timeline') continue
      if (f.type?.eq === 'VIDEO' && a.isImage) continue
      if (f.type?.eq === 'IMAGE' && !a.isImage) continue
      if (f.isMotion?.eq && !a.live) continue
      if (f.isFavorite?.eq && !a.favorite) continue
      if (f.city?.eq && CITIES[a.city].city !== f.city.eq) continue
      hits.push(a)
    }
  }
  const page = hits.slice(offset, offset + size)
  const next = offset + size < hits.length ? String(offset + size) : null
  return {
    albums: { count: 0, total: 0, items: [], facets: [] },
    assets: { count: page.length, total: hits.length, items: page.map(assetDto), facets: [], nextCursor: next, nextPage: next },
  }
}

// ---- router -------------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://mock')
  if (!url.pathname.startsWith('/api/')) return false
  const path = url.pathname.slice(4)
  const q = url.searchParams
  const method = req.method ?? 'GET'
  let m: RegExpExecArray | null

  // Small latency so lazy loading and placeholders are visible.
  await new Promise((r) => setTimeout(r, path.includes('thumbnail') ? 30 + Math.random() * 120 : 80))

  if (path === '/server/version') return send(res, 200, { major: 3, minor: 4, patch: 0, prerelease: null, featureLevel: 2 }), true
  if (path === '/server/ping') return send(res, 200, { res: 'pong' }), true
  if (path === '/auth/login' && method === 'POST') {
    const body = await readJson<{ email?: string }>(req)
    res.setHeader('Set-Cookie', ['immich_access_token=mock-token; Path=/; HttpOnly; SameSite=Lax'])
    return send(res, 201, { accessToken: 'mock-token', userId: USER.id, userEmail: body.email ?? USER.email, name: USER.name, isAdmin: true, isOnboarded: true, profileImagePath: '', shouldChangePassword: false }), true
  }
  if (path === '/auth/logout') {
    res.setHeader('Set-Cookie', ['immich_access_token=; Path=/; Max-Age=0'])
    return send(res, 200, { successful: true, redirectUri: '/auth/login' }), true
  }
  // Like the real server: anything else needs the cookie or a bearer token.
  // Any email/password is accepted at /auth/login.
  const authed = /immich_access_token=mock-token/.test(req.headers.cookie ?? '') || req.headers.authorization === 'Bearer mock-token'
  if (!authed) return send(res, 401, { message: 'Authentication required', statusCode: 401 }), true
  if (path === '/auth/validateToken') return send(res, 200, { authStatus: true }), true
  if (path === '/users/me') return send(res, 200, { ...USER, isAdmin: true, status: 'active', shouldChangePassword: false, createdAt: USER.profileChangedAt, updatedAt: USER.profileChangedAt, deletedAt: null, oauthId: '', storageLabel: 'admin', quotaSizeInBytes: null, quotaUsageInBytes: null, license: null, clusterGroupId: USER.id }), true

  if (path === '/timeline/buckets') {
    const tq = parseTimelineQuery(q)
    const out: { timeBucket: string; count: number }[] = []
    for (const mo of MONTHS) {
      let n = 0
      for (const a of monthAssets(mo.key)) if (matches(a, tq)) n++
      if (n) out.push({ timeBucket: bucketKey(mo.key), count: n })
    }
    if (tq.order === 'desc') out.reverse()
    return send(res, 200, out), true
  }
  if (path === '/timeline/bucket') {
    const tq = parseTimelineQuery(q)
    const tb = q.get('timeBucket') ?? ''
    const key = Number(tb.slice(0, 4)) * 100 + Number(tb.slice(5, 7))
    const list = monthAssets(key).filter((a) => matches(a, tq))
    if (tq.order === 'desc') list.reverse()
    return send(res, 200, columnar(list)), true
  }

  if ((m = /^\/assets\/([^/]+)\/thumbnail$/.exec(path))) {
    const p = parseAssetId(m[1])
    const a = p && monthAssets(p.month)[p.index]
    if (!a) return send(res, 404, { message: 'Not found' }), true
    const long = q.get('size') === 'thumbnail' ? 320 : 1440
    res.setHeader('Cache-Control', 'private, max-age=86400')
    return send(res, 200, sceneSvg(a.seed, a.ratio, long), 'image/svg+xml'), true
  }
  if ((m = /^\/assets\/([^/]+)\/(original|video\/playback|video\/stream.*)$/.exec(path))) {
    return send(res, 404, { message: 'Mock mode has no media files' }), true
  }
  if ((m = /^\/assets\/([0-9a-f-]{36})$/.exec(path)) && method === 'GET') {
    const a = getAsset(m[1])
    return a ? send(res, 200, assetDto(a)) : send(res, 404, { message: 'Not found' }), true
  }
  if (path === '/assets' && method === 'PUT') {
    const body = await readJson<{ ids: string[]; isFavorite?: boolean }>(req)
    if (body.isFavorite !== undefined) for (const id of body.ids) edits.favorite.set(id, body.isFavorite)
    return send(res, 204), true
  }
  if (path === '/assets' && method === 'DELETE') {
    const body = await readJson<{ ids: string[] }>(req)
    for (const id of body.ids) edits.trashed.set(id, true)
    return send(res, 204), true
  }
  if (path === '/trash/restore/assets' && method === 'POST') {
    const body = await readJson<{ ids: string[] }>(req)
    for (const id of body.ids) edits.trashed.set(id, false)
    return send(res, 200, { count: body.ids.length }), true
  }
  if (path === '/assets/bulk-upload-check' && method === 'POST') {
    const body = await readJson<{ assets: { id: string; checksum: string }[] }>(req)
    return send(res, 200, {
      results: body.assets.map((x) => (hash32(x.checksum) % 5 === 0 ? { id: x.id, action: 'reject', reason: 'duplicate', assetId: assetId(202611, 0) } : { id: x.id, action: 'accept' })),
    }), true
  }
  if (path === '/assets' && method === 'POST') {
    await readBody(req)
    return send(res, 201, { id: assetId(202611, hash32(Date.now()) % 50), status: 'created' }), true
  }
  if (path === '/assets/statistics') return send(res, 200, { images: 48000, videos: 4100, total: 52100 }), true

  if (path === '/albums') {
    const shared = q.get('isShared')
    const list = ALBUMS.filter((a) => shared === null || String(a.shared) === shared)
    return send(res, 200, list.map(albumDto)), true
  }
  if ((m = /^\/albums\/([^/]+)$/.exec(path))) {
    const al = ALBUMS.find((a) => a.id === m![1])
    return al ? send(res, 200, albumDto(al)) : send(res, 404, { message: 'Not found' }), true
  }

  if (path === '/people') return send(res, 200, { total: PEOPLE.length, hidden: 0, hasNextPage: false, people: PEOPLE.map((p) => personDto(p.index)) }), true
  if ((m = /^\/people\/([^/]+)\/thumbnail$/.exec(path))) {
    const p = PEOPLE.find((x) => x.id === m![1])
    return p ? send(res, 200, avatarSvg(p.index, p.name), 'image/svg+xml') : send(res, 404, {}), true
  }
  if ((m = /^\/people\/([^/]+)$/.exec(path))) {
    const p = PEOPLE.find((x) => x.id === m![1])
    return p ? send(res, 200, personDto(p.index)) : send(res, 404, {}), true
  }

  if (path === '/memories') {
    const forDate = q.get('for') ?? new Date().toISOString().slice(0, 10)
    const mm = Number(forDate.slice(5, 7))
    const years = [2015, 2018, 2021, 2023, 2024]
    const out = years.map((y, i) => {
      const list = monthAssets(y * 100 + mm).filter((a) => a.visibility === 'timeline' && !a.trashed && a.isImage)
      const start = Math.floor(list.length / 3)
      const assets = list.slice(start, start + 12)
      return {
        id: `000e0e00-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
        type: 'on_this_day',
        data: { year: y },
        assets: assets.map(assetDto),
        createdAt: forDate + 'T00:00:00.000Z',
        updatedAt: forDate + 'T00:00:00.000Z',
        memoryAt: `${y}${forDate.slice(4)}T00:00:00.000Z`,
        ownerId: USER.id,
        isSaved: false,
      }
    })
    return send(res, 200, out.filter((x) => x.assets.length)), true
  }

  if (path === '/map/markers') {
    const out = []
    for (const a of allAssets()) {
      if (a.seed % 25 !== 0 || a.visibility !== 'timeline' || a.trashed) continue
      const c = CITIES[a.city]
      out.push({ id: a.id, lat: c.lat, lon: c.lon, city: c.city, state: c.state, country: c.country })
    }
    return send(res, 200, out), true
  }
  if (path === '/search/explore') {
    const items = CITIES.map((c, i) => {
      for (const mo of MONTHS) if (mo.city === i) return { value: c.city, data: assetDto(monthAssets(mo.key)[0]) }
      return null
    }).filter(Boolean)
    return send(res, 200, [{ fieldName: 'exifInfo.city', items }]), true
  }
  if (path === '/search/suggestions') {
    const type = q.get('type')
    const list =
      type === 'city' ? CITIES.map((c) => c.city)
      : type === 'country' ? [...new Set(CITIES.map((c) => c.country))]
      : type === 'camera-make' ? ['Apple', 'Sony', 'Fujifilm']
      : []
    return send(res, 200, list), true
  }
  if (path === '/search/smart' && method === 'POST') {
    const body = await readJson<{ query?: string; size?: number; page?: number }>(req)
    const page = body.page ?? 1
    const size = body.size ?? 100
    const all = sampleAssets(`${body.query ?? ''}`, 180)
    const items = all.slice((page - 1) * size, page * size)
    const nextPage = page * size < all.length ? String(page + 1) : null
    return send(res, 200, { albums: { count: 0, total: 0, items: [], facets: [] }, assets: { count: items.length, total: all.length, items: items.map(assetDto), facets: [], nextPage, nextCursor: null } }), true
  }
  if (path === '/search/metadata' && method === 'POST') {
    return send(res, 200, metadataSearch(await readJson<MetadataBody>(req))), true
  }

  send(res, 404, { message: `mock: ${method} ${path} not implemented` })
  return true
}

export function mockImmich(): Plugin {
  return {
    name: 'memories-mock-immich',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info('\n  [memories] MOCK MODE: /api is served from fixtures (mock/), not Immich\n')
      server.middlewares.use((req, res, next) => {
        handle(req, res)
          .then((handled) => {
            if (!handled) next()
          })
          .catch((err) => {
            server.config.logger.error(String(err?.stack ?? err))
            send(res, 500, { message: String(err) })
          })
      })
    },
  }
}
