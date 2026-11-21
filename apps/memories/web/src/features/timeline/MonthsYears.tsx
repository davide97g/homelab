import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Thumb } from '@/components/Thumb'
import { monthName, parseBucket, formatCount } from '@/lib/format'
import type { TimelineAsset, TimelineStore } from './store'

/** Prefer a favourite, else a photo from the middle of the month. */
function keyAsset(assets: TimelineAsset[] | undefined): TimelineAsset | undefined {
  if (!assets?.length) return undefined
  const mid = Math.floor(assets.length / 2)
  const fav = assets.find((a) => a.isFavorite && a.isImage)
  if (fav) return fav
  for (let d = 0; d < assets.length; d++) {
    const a = assets[(mid + d) % assets.length]
    if (a.isImage) return a
  }
  return assets[mid]
}

function topCity(assets: TimelineAsset[] | undefined): string | null {
  if (!assets) return null
  const counts = new Map<string, number>()
  for (const a of assets) if (a.city) counts.set(a.city, (counts.get(a.city) ?? 0) + 1)
  let best: string | null = null
  let n = 0
  for (const [c, k] of counts)
    if (k > n) {
      best = c
      n = k
    }
  return best
}

/**
 * Load the buckets behind cards that are on (or near) screen. A scroll-driven
 * check rather than IntersectionObserver: cheap for ~200 cards and immune to
 * observer timing quirks inside nested scroll containers.
 */
function useLoadVisibleCards(ref: React.RefObject<HTMLDivElement | null>, store: TimelineStore, deps: unknown) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const check = () => {
      raf = 0
      const top = -600
      const bottom = window.innerHeight + 600
      for (const card of el.querySelectorAll<HTMLElement>('[data-bi]')) {
        const r = card.getBoundingClientRect()
        if (r.bottom < top || r.top > bottom) continue
        const bi = Number(card.dataset.bi)
        if (!store.buckets[bi]?.assets) store.loadBucket(bi)
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check)
    }
    check()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ref, store, deps])
}

function useStartAtEnd(ref: React.RefObject<HTMLDivElement | null>, ready: boolean, anchorId?: string | null) {
  const done = useRef(false)
  useLayoutEffect(() => {
    if (done.current || !ready || !ref.current) return
    done.current = true
    const el = ref.current
    const anchor = anchorId ? el.querySelector<HTMLElement>(`[data-anchor="${anchorId}"]`) : null
    if (anchor) el.scrollTop = anchor.offsetTop - 120
    else el.scrollTop = el.scrollHeight
  }, [ready, ref, anchorId])
}

// ---- Months --------------------------------------------------------------------

function MonthCard({ store, bi, onPick }: { store: TimelineStore; bi: number; onPick: (bi: number) => void }) {
  const b = store.buckets[bi]
  const { y, m } = parseBucket(b.timeBucket)
  const key = keyAsset(b.assets)
  const city = topCity(b.assets)
  return (
    <button
      data-bi={bi}
      data-anchor={b.timeBucket.slice(0, 7)}
      onClick={() => onPick(bi)}
      className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[16px] bg-placeholder text-left text-white transition active:scale-[0.98]"
    >
      {key && <Thumb id={key.id} thumbhash={key.thumbhash} size="preview" className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.03]" />}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 to-transparent" />
      <div className="absolute top-3.5 left-4 right-4">
        <div className="font-display text-[24px] leading-tight font-bold drop-shadow">
          {monthName(m)} <span className="font-semibold opacity-90">{y}</span>
        </div>
        <div className="text-[13px] font-medium opacity-85 drop-shadow">
          {city ? `${city} · ` : ''}
          {formatCount(b.count)} items
        </div>
      </div>
    </button>
  )
}

export function MonthsView({
  store,
  onPickMonth,
  anchorYear,
  bottomInset,
}: {
  store: TimelineStore
  onPickMonth: (bi: number) => void
  anchorYear?: number | null
  bottomInset: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const ready = store.status === 'ready'
  const anchorId = anchorYear ? store.buckets.find((b) => parseBucket(b.timeBucket).y === anchorYear)?.timeBucket.slice(0, 7) : null
  useStartAtEnd(ref, ready && store.buckets.length > 0, anchorId)
  useLoadVisibleCards(ref, store, store.buckets.length)
  return (
    <div ref={ref} className="absolute inset-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 pt-[calc(env(safe-area-inset-top)+92px)] md:grid-cols-2 xl:grid-cols-3" style={{ paddingBottom: bottomInset }}>
        {store.buckets.map((b, bi) => (
          <MonthCard key={b.timeBucket} store={store} bi={bi} onPick={onPickMonth} />
        ))}
      </div>
    </div>
  )
}

// ---- Years -----------------------------------------------------------------------

function YearCard({ store, year, bi, count, onPick }: { store: TimelineStore; year: number; bi: number; count: number; onPick: (y: number) => void }) {
  const key = keyAsset(store.buckets[bi]?.assets)
  return (
    <button
      data-bi={bi}
      data-anchor={String(year)}
      onClick={() => onPick(year)}
      className="group relative block aspect-[3/2] w-full overflow-hidden rounded-[16px] bg-placeholder text-left text-white transition active:scale-[0.98] md:aspect-[16/10]"
    >
      {key && <Thumb id={key.id} thumbhash={key.thumbhash} size="preview" className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.03]" />}
      <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/25" />
      <div className="absolute top-3 left-4">
        <div className="font-display text-[40px] leading-none font-bold tracking-tight drop-shadow">{year}</div>
        <div className="mt-1 text-[13px] font-medium opacity-85">{formatCount(count)} items</div>
      </div>
    </button>
  )
}

export function YearsView({ store, onPickYear, bottomInset }: { store: TimelineStore; onPickYear: (y: number) => void; bottomInset: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const years = useMemo(() => {
    const map = new Map<number, { year: number; bi: number; best: number; count: number }>()
    store.buckets.forEach((b, bi) => {
      const { y } = parseBucket(b.timeBucket)
      const e = map.get(y)
      if (!e) map.set(y, { year: y, bi, best: b.count, count: b.count })
      else {
        e.count += b.count
        if (b.count > e.best) {
          e.best = b.count
          e.bi = bi
        }
      }
    })
    return [...map.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, store.buckets])
  useStartAtEnd(ref, store.status === 'ready' && years.length > 0)
  useLoadVisibleCards(ref, store, years.length)
  return (
    <div ref={ref} className="absolute inset-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 pt-[calc(env(safe-area-inset-top)+92px)] md:grid-cols-2" style={{ paddingBottom: bottomInset }}>
        {years.map((y) => (
          <YearCard key={y.year} store={store} year={y.year} bi={y.bi} count={y.count} onPick={onPickYear} />
        ))}
      </div>
    </div>
  )
}
