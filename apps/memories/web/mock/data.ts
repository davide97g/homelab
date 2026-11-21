// Deterministic fixture library for `bun run dev:mock`. ~53k assets over
// 2012-2026, generated on demand (nothing is stored), plus albums, people and
// memories. Images are drawn here as SVG; thumbhashes are computed from the
// same scene so the placeholder matches the picture that fades in over it.
import { rgbaToThumbHash } from 'thumbhash'

// ---------- PRNG ------------------------------------------------------------

export function hash32(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0
  for (const p of parts) {
    const s = String(p)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    h ^= 0x9e3779b9
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
  }
  h ^= h >>> 13
  h = Math.imul(h, 3266489909) >>> 0
  h ^= h >>> 16
  return h >>> 0
}
const unit = (seed: number, salt: number) => hash32(seed, salt) / 4294967296

// ---------- places ----------------------------------------------------------

export const CITIES = [
  { city: 'Milan', state: 'Lombardy', country: 'Italy', lat: 45.4642, lon: 9.19 },
  { city: 'Turin', state: 'Piedmont', country: 'Italy', lat: 45.0703, lon: 7.6869 },
  { city: 'Venice', state: 'Veneto', country: 'Italy', lat: 45.4408, lon: 12.3155 },
  { city: 'Rome', state: 'Lazio', country: 'Italy', lat: 41.9028, lon: 12.4964 },
  { city: 'Florence', state: 'Tuscany', country: 'Italy', lat: 43.7696, lon: 11.2558 },
  { city: 'Naples', state: 'Campania', country: 'Italy', lat: 40.8518, lon: 14.2681 },
  { city: 'Paris', state: 'Ile-de-France', country: 'France', lat: 48.8566, lon: 2.3522 },
  { city: 'London', state: 'England', country: 'United Kingdom', lat: 51.5072, lon: -0.1276 },
  { city: 'Barcelona', state: 'Catalonia', country: 'Spain', lat: 41.3874, lon: 2.1686 },
  { city: 'Lisbon', state: 'Lisbon', country: 'Portugal', lat: 38.7223, lon: -9.1393 },
  { city: 'Tokyo', state: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503 },
  { city: 'New York', state: 'New York', country: 'United States', lat: 40.7128, lon: -74.006 },
  { city: 'Reykjavik', state: 'Capital Region', country: 'Iceland', lat: 64.1466, lon: -21.9426 },
  { city: 'Amsterdam', state: 'North Holland', country: 'Netherlands', lat: 52.3676, lon: 4.9041 },
  { city: 'Zermatt', state: 'Valais', country: 'Switzerland', lat: 46.0207, lon: 7.7491 },
  { city: 'Oslo', state: 'Oslo', country: 'Norway', lat: 59.9139, lon: 10.7522 },
]

// ---------- months ----------------------------------------------------------

export const FIRST = { y: 2012, m: 1 }
export const LAST = { y: 2026, m: 11 }

export interface Month {
  key: number // yyyymm
  y: number
  m: number
  count: number
  city: number // index in CITIES: where most of this month happened
}

export const MONTHS: Month[] = (() => {
  const out: Month[] = []
  for (let y = FIRST.y; y <= LAST.y; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === LAST.y && m > LAST.m) break
      const key = y * 100 + m
      const r = unit(key, 1)
      const summer = m >= 6 && m <= 9 ? 160 : m === 12 ? 90 : 0
      const growth = (y - FIRST.y) * 14
      const count = Math.round(70 + r * 300 + summer + growth)
      const trip = unit(key, 2) < 0.35
      const city = trip ? 1 + Math.floor(unit(key, 3) * (CITIES.length - 1)) : 0
      out.push({ key, y, m, count, city })
    }
  }
  return out
})()

const monthByKey = new Map(MONTHS.map((m) => [m.key, m]))

// ---------- assets ----------------------------------------------------------

export type Visibility = 'timeline' | 'archive' | 'hidden' | 'locked'

export interface MockAsset {
  id: string
  month: number
  index: number
  seed: number
  takenAt: Date
  isImage: boolean
  duration: number | null
  ratio: number
  favorite: boolean
  live: string | null
  city: number
  visibility: Visibility
  trashed: boolean
  people: number[]
  make: string
  model: string
  lens: string
}

const RATIOS = [4 / 3, 4 / 3, 4 / 3, 3 / 4, 3 / 4, 16 / 9, 9 / 16, 1]
const CAMERAS = [
  ['Apple', 'iPhone 15 Pro', 'iPhone 15 Pro back triple camera 6.765mm f/1.78'],
  ['Apple', 'iPhone 12', 'iPhone 12 back dual wide camera 4.2mm f/1.6'],
  ['Sony', 'ILCE-7M3', 'FE 24-70mm F2.8 GM'],
  ['Fujifilm', 'X100V', 'Fixed 23mm f/2'],
]

export const assetId = (month: number, index: number, kind = '8') =>
  `${month.toString(16).padStart(8, '0')}-0000-4000-${kind}000-${index.toString(16).padStart(12, '0')}`

export function parseAssetId(id: string): { month: number; index: number; live: boolean } | null {
  const m = /^([0-9a-f]{8})-0000-4000-([89])000-([0-9a-f]{12})$/.exec(id)
  if (!m) return null
  return { month: parseInt(m[1], 16), index: parseInt(m[3], 16), live: m[2] === '9' }
}

// In-memory edits made through the UI while the dev server runs.
export const edits = {
  favorite: new Map<string, boolean>(),
  trashed: new Map<string, boolean>(),
}

export const PEOPLE = [
  'Giulia', 'Marco', 'Sofia', 'Luca', 'Chiara', 'Matteo', 'Elena', 'Pietro', 'Anna', 'Tommaso', 'Nonna Rosa', 'Biscotto',
].map((name, i) => ({ id: `0000a11e-0000-4000-8000-${i.toString(16).padStart(12, '0')}`, name, index: i }))

function buildAsset(mo: Month, index: number): MockAsset {
  const seed = hash32(mo.key, index)
  const start = Date.UTC(mo.y, mo.m - 1, 1)
  const end = Date.UTC(mo.m === 12 ? mo.y + 1 : mo.y, mo.m === 12 ? 0 : mo.m, 1)
  const t = start + ((index + 0.5) / mo.count) * (Math.min(end, Date.now()) - start)
  const isImage = unit(seed, 1) > 0.08
  const id = assetId(mo.key, index)
  const people: number[] = []
  for (const p of PEOPLE) if (unit(seed, 100 + p.index) < (p.index < 3 ? 0.12 : 0.04)) people.push(p.index)
  const cam = CAMERAS[mo.y < 2017 ? 1 + (seed % 3) : seed % 4 === 0 ? 2 + (seed % 2) : 0]
  const v = unit(seed, 7)
  return {
    id,
    month: mo.key,
    index,
    seed,
    takenAt: new Date(t),
    isImage,
    duration: isImage ? null : Math.round(2000 + unit(seed, 2) * 110000),
    ratio: RATIOS[seed % RATIOS.length],
    favorite: edits.favorite.get(id) ?? unit(seed, 3) < 0.045,
    live: isImage && unit(seed, 4) < 0.12 ? assetId(mo.key, index, '9') : null,
    city: unit(seed, 5) < 0.85 ? mo.city : seed % CITIES.length,
    visibility: v < 0.004 ? 'hidden' : v < 0.012 ? 'archive' : 'timeline',
    trashed: edits.trashed.get(id) ?? unit(seed, 8) < 0.0015,
    people,
    make: cam[0],
    model: cam[1],
    lens: cam[2],
  }
}

const monthCache = new Map<number, MockAsset[]>()
export function monthAssets(key: number): MockAsset[] {
  const mo = monthByKey.get(key)
  if (!mo) return []
  let a = monthCache.get(key)
  if (!a) {
    a = Array.from({ length: mo.count }, (_, i) => buildAsset(mo, i))
    monthCache.set(key, a)
  }
  // Apply live edits on read.
  for (const x of a) {
    const f = edits.favorite.get(x.id)
    if (f !== undefined) x.favorite = f
    const tr = edits.trashed.get(x.id)
    if (tr !== undefined) x.trashed = tr
  }
  return a
}

export function getAsset(id: string): MockAsset | null {
  const p = parseAssetId(id)
  if (!p) return null
  return monthAssets(p.month)[p.index] ?? null
}

export function* allAssets(): Generator<MockAsset> {
  for (const mo of MONTHS) yield* monthAssets(mo.key)
}

// ---------- albums ----------------------------------------------------------

export interface MockAlbum {
  id: string
  name: string
  from: number
  to: number
  every: number
  shared: boolean
  description: string
}

export const ALBUMS: MockAlbum[] = [
  ['Iceland Ring Road', 201607, 201608, 2, false],
  ['Tokyo', 201904, 201904, 1, false],
  ['Wedding', 202106, 202106, 1, true],
  ['Sunday Hikes', 202003, 202010, 6, false],
  ['Biscotto', 201801, 202611, 40, true],
  ['Lisbon Weekend', 202305, 202305, 2, false],
  ['Christmas', 201512, 202512, 25, true],
  ['Paris', 201409, 201409, 1, false],
  ['Film Scans', 201201, 201312, 9, false],
  ['Zermatt Ski', 202402, 202402, 1, false],
  ['Garden', 202404, 202409, 8, false],
  ['Recipes', 201901, 202612, 60, false],
].map(([name, from, to, every, shared], i) => ({
  id: `00a1b0a0-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
  name: name as string,
  from: from as number,
  to: to as number,
  every: every as number,
  shared: shared as boolean,
  description: '',
}))

export const inAlbum = (al: MockAlbum, a: MockAsset) =>
  a.month >= al.from && a.month <= al.to && a.seed % al.every === 0

// ---------- scenes: SVG + thumbhash from one description ---------------------

type RGB = [number, number, number]
interface Scene {
  top: RGB
  bottom: RGB
  sun: { x: number; y: number; r: number; c: RGB } | null
  hill: { c: RGB; base: number; amp: number; freq: number; phase: number }
  hill2: { c: RGB; base: number; amp: number; freq: number; phase: number }
}

const PALETTES: { top: RGB; bottom: RGB; sun: RGB | null; hill: RGB; hill2: RGB }[] = [
  { top: [74, 144, 226], bottom: [190, 225, 250], sun: [255, 244, 200], hill: [62, 120, 70], hill2: [38, 84, 48] }, // day
  { top: [62, 46, 120], bottom: [250, 150, 90], sun: [255, 210, 120], hill: [70, 40, 70], hill2: [36, 20, 44] }, // sunset
  { top: [20, 30, 70], bottom: [70, 80, 140], sun: [235, 235, 255], hill: [20, 26, 50], hill2: [10, 14, 30] }, // night
  { top: [120, 190, 210], bottom: [230, 240, 235], sun: null, hill: [40, 140, 160], hill2: [20, 95, 120] }, // sea
  { top: [200, 215, 230], bottom: [245, 248, 252], sun: null, hill: [220, 228, 238], hill2: [150, 165, 185] }, // snow
  { top: [250, 200, 160], bottom: [255, 235, 210], sun: [255, 250, 230], hill: [190, 120, 80], hill2: [140, 80, 60] }, // desert
  { top: [110, 150, 120], bottom: [200, 220, 180], sun: null, hill: [70, 110, 60], hill2: [40, 70, 40] }, // forest
  { top: [240, 170, 190], bottom: [255, 225, 210], sun: [255, 255, 240], hill: [150, 100, 140], hill2: [100, 60, 100] }, // pink
]

function jitter(c: RGB, seed: number, salt: number, amt = 26): RGB {
  return c.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (unit(seed, salt + i) - 0.5) * amt)))) as RGB
}

export function sceneFor(seed: number): Scene {
  const p = PALETTES[hash32(seed, 'pal') % PALETTES.length]
  return {
    top: jitter(p.top, seed, 10),
    bottom: jitter(p.bottom, seed, 20),
    sun: p.sun ? { x: 0.15 + unit(seed, 30) * 0.7, y: 0.18 + unit(seed, 31) * 0.3, r: 0.06 + unit(seed, 32) * 0.08, c: p.sun } : null,
    hill: { c: jitter(p.hill, seed, 40), base: 0.6 + unit(seed, 43) * 0.12, amp: 0.04 + unit(seed, 44) * 0.08, freq: 1 + unit(seed, 45) * 3, phase: unit(seed, 46) * 6.28 },
    hill2: { c: jitter(p.hill2, seed, 50), base: 0.78 + unit(seed, 53) * 0.1, amp: 0.03 + unit(seed, 54) * 0.06, freq: 1.5 + unit(seed, 55) * 3, phase: unit(seed, 56) * 6.28 },
  }
}

const hillY = (h: Scene['hill'], u: number) => h.base + Math.sin(u * h.freq * Math.PI + h.phase) * h.amp

function shade(s: Scene, u: number, v: number, ratio: number): RGB {
  if (v > hillY(s.hill2, u)) return s.hill2.c
  if (v > hillY(s.hill, u)) return s.hill.c
  if (s.sun) {
    const dx = (u - s.sun.x) * ratio
    const dy = v - s.sun.y
    if (dx * dx + dy * dy < s.sun.r * s.sun.r) return s.sun.c
  }
  return [0, 1, 2].map((i) => s.top[i] + (s.bottom[i] - s.top[i]) * v) as RGB
}

const thumbhashCache = new Map<string, string>()
export function thumbhashFor(seed: number, ratio: number): string {
  const key = `${seed}:${ratio}`
  let th = thumbhashCache.get(key)
  if (th) return th
  const w = ratio >= 1 ? 32 : Math.max(8, Math.round(32 * ratio))
  const h = ratio >= 1 ? Math.max(8, Math.round(32 / ratio)) : 32
  const s = sceneFor(seed)
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = shade(s, (x + 0.5) / w, (y + 0.5) / h, ratio)
      const o = (y * w + x) * 4
      rgba[o] = c[0]
      rgba[o + 1] = c[1]
      rgba[o + 2] = c[2]
      rgba[o + 3] = 255
    }
  th = Buffer.from(rgbaToThumbHash(w, h, rgba)).toString('base64')
  thumbhashCache.set(key, th)
  return th
}

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`

function hillPath(h: Scene['hill'], W: number, H: number): string {
  const pts: string[] = []
  for (let i = 0; i <= 48; i++) {
    const u = i / 48
    pts.push(`${(u * W).toFixed(1)},${(hillY(h, u) * H).toFixed(1)}`)
  }
  return `M0,${H} L${pts.join(' L')} L${W},${H} Z`
}

export function sceneSvg(seed: number, ratio: number, long: number, label?: string): string {
  const W = ratio >= 1 ? long : Math.round(long * ratio)
  const H = ratio >= 1 ? Math.round(long / ratio) : long
  const s = sceneFor(seed)
  const sun = s.sun
    ? `<circle cx="${s.sun.x * W}" cy="${s.sun.y * H}" r="${s.sun.r * H}" fill="${rgb(s.sun.c)}"/>`
    : ''
  const text = label
    ? `<text x="${W / 2}" y="${H * 0.5}" font-family="-apple-system,system-ui,sans-serif" font-size="${Math.round(H / 14)}" font-weight="600" text-anchor="middle" fill="rgba(255,255,255,.85)">${label}</text>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rgb(s.top)}"/><stop offset="1" stop-color="${rgb(s.bottom)}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>${sun}<path d="${hillPath(s.hill, W, H)}" fill="${rgb(s.hill.c)}"/><path d="${hillPath(s.hill2, W, H)}" fill="${rgb(s.hill2.c)}"/>${text}</svg>`
}

export function avatarSvg(index: number, name: string): string {
  const s = sceneFor(hash32('person', index))
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${rgb(s.top)}"/><stop offset="1" stop-color="${rgb(s.hill.c)}"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><circle cx="128" cy="104" r="46" fill="rgba(255,255,255,.35)"/><path d="M40,256 C50,170 206,170 216,256 Z" fill="rgba(255,255,255,.35)"/><text x="128" y="120" font-family="-apple-system,system-ui,sans-serif" font-size="44" font-weight="700" text-anchor="middle" fill="white">${initials}</text></svg>`
}
