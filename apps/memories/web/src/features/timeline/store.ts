import { api } from '@/lib/api/client'
import type { TimeBucketAssetResponseDto, TimelineFilter } from '@/lib/api/types'

export interface TimelineAsset {
  id: string
  ratio: number
  thumbhash: string | null
  fileCreatedAt: string
  localOffsetHours: number
  isImage: boolean
  duration: number | null
  isFavorite: boolean
  livePhotoVideoId: string | null
  city: string | null
  country: string | null
}

export interface Bucket {
  timeBucket: string
  count: number
  /** global index of the bucket's first asset */
  start: number
  assets?: TimelineAsset[]
  status: 'idle' | 'queued' | 'loading' | 'loaded' | 'error'
}

/**
 * Anything the viewer can page through: the timeline (lazy, 50k+) or a plain
 * list (search results, memories).
 */
export interface AssetSource {
  readonly total: number
  assetAt(i: number): TimelineAsset | undefined
  ensure(from: number, to: number): void
  indexOf(id: string): number
  subscribe(fn: () => void): () => void
  getVersion(): number
  remove(ids: string[]): void
  patch(id: string, p: Partial<TimelineAsset>): void
}

export function unpackBucket(d: TimeBucketAssetResponseDto): TimelineAsset[] {
  const out: TimelineAsset[] = []
  for (let i = 0; i < d.id.length; i++) {
    out.push({
      id: d.id[i],
      ratio: d.ratio[i] || 1,
      thumbhash: d.thumbhash[i] ?? null,
      fileCreatedAt: d.fileCreatedAt[i],
      localOffsetHours: d.localOffsetHours[i] ?? 0,
      isImage: d.isImage[i],
      duration: d.duration[i] ?? null,
      isFavorite: d.isFavorite[i],
      livePhotoVideoId: d.livePhotoVideoId[i] ?? null,
      city: d.city?.[i] ?? null,
      country: d.country?.[i] ?? null,
    })
  }
  return out
}

class Emitter {
  private fns = new Set<() => void>()
  private version = 0
  private scheduled = false
  subscribe = (fn: () => void) => {
    this.fns.add(fn)
    return () => {
      this.fns.delete(fn)
    }
  }
  getVersion = () => this.version
  /** Coalesce bursts of bucket arrivals into one render per frame. */
  emit() {
    this.version++
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      for (const f of this.fns) f()
    })
  }
}

const MAX_PARALLEL = 4

export class TimelineStore extends Emitter implements AssetSource {
  readonly filter: TimelineFilter
  buckets: Bucket[] = []
  total = 0
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
  error: string | null = null
  /** remembered UI state, so returning to a screen restores it */
  ui: { scrollTop: number | null; columnIndex: number | null } = { scrollTop: null, columnIndex: null }

  private queue: number[] = []
  private inflight = 0
  private wanted = new Set<number>()
  private idIndex = new Map<string, number>() // id -> bucket index

  constructor(filter: TimelineFilter) {
    super()
    this.filter = filter
  }

  async init(force = false) {
    if (this.status === 'loading' || (this.status === 'ready' && !force)) return
    this.status = 'loading'
    this.emit()
    try {
      const list = await api.timelineBuckets(this.filter)
      // Server returns newest first by default; we asked for asc, but sort to be safe.
      list.sort((a, b) => (a.timeBucket < b.timeBucket ? -1 : a.timeBucket > b.timeBucket ? 1 : 0))
      const old = new Map(this.buckets.map((b) => [b.timeBucket, b]))
      this.buckets = list.map((b) => {
        const prev = old.get(b.timeBucket)
        const keep = !force && prev?.assets && prev.assets.length === b.count
        return { timeBucket: b.timeBucket, count: b.count, start: 0, assets: keep ? prev!.assets : undefined, status: keep ? 'loaded' : 'idle' }
      })
      this.reindex()
      this.status = 'ready'
    } catch (e) {
      this.status = 'error'
      this.error = e instanceof Error ? e.message : String(e)
    }
    this.emit()
  }

  private reindex() {
    let s = 0
    this.idIndex.clear()
    this.buckets.forEach((b, bi) => {
      b.start = s
      s += b.count
      if (b.assets) for (const a of b.assets) this.idIndex.set(a.id, bi)
    })
    this.total = s
  }

  bucketIndexAt(i: number): number {
    let lo = 0
    let hi = this.buckets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.buckets[mid].start <= i) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  assetAt(i: number): TimelineAsset | undefined {
    if (i < 0 || i >= this.total) return undefined
    const b = this.buckets[this.bucketIndexAt(i)]
    return b.assets?.[i - b.start]
  }

  indexOf(id: string): number {
    const bi = this.idIndex.get(id)
    if (bi === undefined) return -1
    const b = this.buckets[bi]
    const k = b.assets!.findIndex((a) => a.id === id)
    return k < 0 ? -1 : b.start + k
  }

  /** Declare the global index range that matters now; everything else queued is dropped. */
  ensure(from: number, to: number) {
    if (!this.buckets.length) return
    const a = this.bucketIndexAt(Math.max(0, from))
    const b = this.bucketIndexAt(Math.min(this.total - 1, Math.max(0, to)))
    this.wanted = new Set()
    for (let bi = a; bi <= b; bi++) this.wanted.add(bi)
    this.queue = this.queue.filter((bi) => {
      if (this.wanted.has(bi)) return true
      this.buckets[bi].status = 'idle'
      return false
    })
    for (let bi = a; bi <= b; bi++) this.request(bi)
  }

  /** Load one bucket regardless of the wanted window (Months/Years cards). */
  loadBucket(bi: number) {
    this.wanted.add(bi)
    this.request(bi)
  }

  private request(bi: number) {
    const b = this.buckets[bi]
    if (!b || b.status !== 'idle') return
    b.status = 'queued'
    this.queue.push(bi)
    this.pump()
  }

  private pump() {
    while (this.inflight < MAX_PARALLEL && this.queue.length) {
      // Nearest-to-now first: the most recently requested window wins.
      const bi = this.queue.shift()!
      const b = this.buckets[bi]
      if (b.status !== 'queued') continue
      b.status = 'loading'
      this.inflight++
      api
        .timelineBucket(this.filter, b.timeBucket)
        .then((d) => {
          const assets = unpackBucket(d)
          b.assets = assets
          b.status = 'loaded'
          if (assets.length !== b.count) {
            // Counts drifted (uploads/deletes since the index): re-flow.
            b.count = assets.length
            this.reindex()
          } else for (const a of assets) this.idIndex.set(a.id, bi)
        })
        .catch((e) => {
          if (import.meta.env.DEV) console.warn('[timeline] bucket failed', b.timeBucket, e)
          b.status = 'error'
          setTimeout(() => {
            if (b.status === 'error') b.status = 'idle'
          }, 3000)
        })
        .finally(() => {
          this.inflight--
          this.emit()
          this.pump()
        })
    }
  }

  remove(ids: string[]) {
    const set = new Set(ids)
    let changed = false
    for (const b of this.buckets) {
      if (!b.assets) continue
      const before = b.assets.length
      b.assets = b.assets.filter((a) => !set.has(a.id))
      if (b.assets.length !== before) {
        b.count = b.assets.length
        changed = true
      }
    }
    if (changed) {
      this.buckets = this.buckets.filter((b) => b.count > 0)
      this.reindex()
      this.emit()
    }
  }

  patch(id: string, p: Partial<TimelineAsset>) {
    const i = this.indexOf(id)
    if (i < 0) return
    const b = this.buckets[this.bucketIndexAt(i)]
    b.assets![i - b.start] = { ...b.assets![i - b.start], ...p }
    this.emit()
  }
}

const stores = new Map<string, TimelineStore>()

export function filterKey(f: TimelineFilter) {
  return JSON.stringify(Object.entries(f).sort(([a], [b]) => a.localeCompare(b)))
}

export function getTimelineStore(f: TimelineFilter): TimelineStore {
  const key = filterKey(f)
  let s = stores.get(key)
  if (!s) {
    s = new TimelineStore(f)
    stores.set(key, s)
  }
  return s
}

/** After a mutation, other cached timelines may be stale: force them to refetch on next view. */
export function invalidateTimelines(except?: unknown) {
  for (const [k, s] of stores) if (s !== except) stores.delete(k)
}

export function clearTimelines() {
  stores.clear()
}

/** Static list wrapped as an AssetSource (search results, memories). */
export class ListSource extends Emitter implements AssetSource {
  items: TimelineAsset[]
  constructor(items: TimelineAsset[]) {
    super()
    this.items = items
  }
  get total() {
    return this.items.length
  }
  assetAt(i: number) {
    return this.items[i]
  }
  ensure() {}
  indexOf(id: string) {
    return this.items.findIndex((a) => a.id === id)
  }
  setItems(items: TimelineAsset[]) {
    this.items = items
    this.emit()
  }
  remove(ids: string[]) {
    const s = new Set(ids)
    this.items = this.items.filter((a) => !s.has(a.id))
    this.emit()
  }
  patch(id: string, p: Partial<TimelineAsset>) {
    this.items = this.items.map((a) => (a.id === id ? { ...a, ...p } : a))
    this.emit()
  }
}

if (import.meta.env.DEV) (globalThis as { __memoriesStores?: unknown }).__memoriesStores = stores
