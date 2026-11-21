import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Check, Heart } from 'lucide-react'
import { thumbUrl } from '@/lib/api/client'
import { thumbhashUrl } from '@/lib/thumbhash'
import { formatDurationMs } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { AssetSource, TimelineAsset } from './store'

export const GAP = 2

/** Column steps for pinch zoom: phone 3/5/7/13, desktop 5/8/12/20 (DESIGN.md). */
export function columnSteps(width: number): number[] {
  if (width >= 1024) return [5, 8, 12, 20]
  if (width >= 640) return [4, 6, 9, 15]
  return [3, 5, 7, 13]
}
export function defaultColumnIndex(width: number) {
  return width >= 1024 ? 1 : 0
}

export interface Selection {
  active: boolean
  ids: Set<string>
  set: (ids: Set<string>) => void
}

export interface GridHandle {
  scrollToIndex: (i: number, align?: 'start' | 'center') => void
}

interface Props {
  source: AssetSource
  /** remembered per-source UI state (scroll + zoom) */
  memory?: { scrollTop: number | null; columnIndex: number | null }
  topInset?: number
  bottomInset?: number
  header?: ReactNode
  footer?: ReactNode
  startAtEnd?: boolean
  /** scroll so this index is at the top on first layout (wins over memory) */
  initialIndex?: number
  onOpen: (index: number) => void
  selection?: Selection
  onVisible?: (first: number, last: number, scrollTop: number) => void
  handleRef?: (h: GridHandle | null) => void
  empty?: ReactNode
}

export function TimelineGrid({
  source,
  memory,
  topInset = 0,
  bottomInset = 0,
  header,
  footer,
  startAtEnd,
  initialIndex,
  onOpen,
  selection,
  onVisible,
  handleRef,
  empty,
}: Props) {
  useSyncExternalStore(source.subscribe, source.getVersion)
  const total = source.total

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [vh, setVh] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const steps = columnSteps(width || 390)
  const [colIdx, setColIdx] = useState<number | null>(memory?.columnIndex ?? null)
  const columnIndex = Math.min(steps.length - 1, colIdx ?? defaultColumnIndex(width || 390))
  const cols = steps[columnIndex]
  const cell = width ? (width - GAP * (cols - 1)) / cols : 0
  const rowH = cell + GAP
  const rows = Math.ceil(total / cols)
  const footerH = footer ? 64 : 0
  const contentH = topInset + Math.max(0, rows * rowH - GAP) + footerH + bottomInset

  // ---- size --------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setVh(el.clientHeight)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    setVh(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // ---- initial position: restore, or open at the newest (bottom) -------------
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (placed.current || !width || !vh || !total) return
    placed.current = true
    const el = scrollRef.current!
    if (initialIndex != null) el.scrollTop = topInset + Math.floor(initialIndex / cols) * rowH - 100
    else if (memory?.scrollTop != null) el.scrollTop = memory.scrollTop
    else if (startAtEnd) el.scrollTop = el.scrollHeight
    setScrollTop(el.scrollTop)
  }, [width, vh, total, memory, startAtEnd, initialIndex, cols, rowH, topInset])

  const onScroll = useCallback(() => {
    const st = scrollRef.current!.scrollTop
    setScrollTop(st)
    if (memory) memory.scrollTop = st
  }, [memory])

  // ---- zoom (pinch / ctrl+wheel / Safari gesture) with anchor ---------------
  const anchor = useRef<{ index: number; y: number } | null>(null)
  const geom = useRef({ cols, rowH, topInset, steps, columnIndex })
  geom.current = { cols, rowH, topInset, steps, columnIndex }

  const zoom = useCallback(
    (dir: 1 | -1, clientY?: number) => {
      const g = geom.current
      const next = Math.max(0, Math.min(g.steps.length - 1, g.columnIndex + dir))
      if (next === g.columnIndex) return
      const el = scrollRef.current!
      const rect = el.getBoundingClientRect()
      const y = clientY !== undefined ? clientY - rect.top : el.clientHeight / 2
      const row = Math.max(0, Math.floor((el.scrollTop + y - g.topInset) / g.rowH))
      anchor.current = { index: row * g.cols, y }
      setColIdx(next)
      if (memory) memory.columnIndex = next
    },
    [memory],
  )

  useLayoutEffect(() => {
    const a = anchor.current
    if (!a || !rowH) return
    anchor.current = null
    const el = scrollRef.current!
    el.scrollTop = topInset + Math.floor(a.index / cols) * rowH - a.y + rowH / 2
    setScrollTop(el.scrollTop)
  }, [cols, rowH, topInset])

  useEffect(() => {
    const el = scrollRef.current!
    let wheelAcc = 0
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      wheelAcc += e.deltaY
      if (Math.abs(wheelAcc) > 30) {
        zoom(wheelAcc > 0 ? 1 : -1, e.clientY)
        wheelAcc = 0
      }
    }
    let pinch: { d: number; y: number } | null = null
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { d: dist(e.touches), y: (e.touches[0].clientY + e.touches[1].clientY) / 2 }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const r = dist(e.touches) / pinch.d
      if (r > 1.25) {
        zoom(-1, pinch.y)
        pinch.d = dist(e.touches)
      } else if (r < 0.8) {
        zoom(1, pinch.y)
        pinch.d = dist(e.touches)
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null
    }
    let gScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gScale = 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const s = (e as unknown as { scale: number }).scale
      if (s / gScale > 1.25) {
        zoom(-1)
        gScale = s
      } else if (s / gScale < 0.8) {
        zoom(1)
        gScale = s
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  }, [zoom])

  // ---- imperative scroll ----------------------------------------------------------
  useEffect(() => {
    handleRef?.({
      scrollToIndex: (i, align = 'start') => {
        const el = scrollRef.current
        if (!el || !rowH) return
        const y = topInset + Math.floor(i / cols) * rowH
        el.scrollTop = align === 'center' ? y - el.clientHeight / 2 + rowH / 2 : y - topInset
        setScrollTop(el.scrollTop)
      },
    })
    return () => handleRef?.(null)
  }, [handleRef, cols, rowH, topInset])

  // ---- window -------------------------------------------------------------------------
  const overscan = Math.ceil(vh / Math.max(rowH, 1) / 2) + 1
  const firstRow = rowH ? Math.max(0, Math.floor((scrollTop - topInset) / rowH) - overscan) : 0
  const lastRow = rowH ? Math.min(rows - 1, Math.ceil((scrollTop + vh - topInset) / rowH) + overscan) : -1
  const first = firstRow * cols
  const last = Math.min(total - 1, (lastRow + 1) * cols - 1)
  const visFirst = rowH ? Math.max(0, Math.floor((scrollTop - topInset) / rowH)) * cols : 0
  const visLast = rowH ? Math.min(total - 1, Math.ceil((scrollTop + vh - topInset) / rowH) * cols - 1) : 0

  useEffect(() => {
    if (!total || last < first) return
    // Fetch one screen beyond what's rendered in each direction.
    const pad = Math.ceil(vh / Math.max(rowH, 1)) * cols
    source.ensure(first - pad, last + pad)
  }, [source, first, last, total, vh, rowH, cols])

  useEffect(() => {
    onVisible?.(visFirst, visLast, scrollTop)
  }, [onVisible, visFirst, visLast, scrollTop])

  // ---- selection drag --------------------------------------------------------------
  const drag = useRef<{ anchor: number; base: Set<string>; adding: boolean; moved: boolean; pointerId: number } | null>(null)
  const suppressClick = useRef(false)
  const indexAt = (clientX: number, clientY: number) => {
    const r = contentRef.current!.getBoundingClientRect()
    const c = Math.min(cols - 1, Math.max(0, Math.floor((clientX - r.left) / (cell + GAP))))
    const row = Math.floor((clientY - r.top - topInset) / rowH)
    return row * cols + c
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (!selection?.active) return
    const i = indexAt(e.clientX, e.clientY)
    const a = source.assetAt(i)
    if (!a) return
    drag.current = { anchor: i, base: new Set(selection.ids), adding: !selection.ids.has(a.id), moved: false, pointerId: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !selection) return
    const i = indexAt(e.clientX, e.clientY)
    if (i === d.anchor && !d.moved) return
    if (!d.moved) {
      d.moved = true
      ;(e.target as Element).setPointerCapture?.(d.pointerId)
    }
    const next = new Set(d.base)
    const [a, b] = i < d.anchor ? [i, d.anchor] : [d.anchor, i]
    for (let k = Math.max(0, a); k <= Math.min(total - 1, b); k++) {
      const x = source.assetAt(k)
      if (!x) continue
      if (d.adding) next.add(x.id)
      else next.delete(x.id)
    }
    selection.set(next)
  }
  const onPointerUp = () => {
    if (drag.current?.moved) suppressClick.current = true
    drag.current = null
  }

  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const t = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null
    if (!t) return
    const i = Number(t.dataset.index)
    const a = source.assetAt(i)
    if (!a) return
    if (selection?.active) {
      const next = new Set(selection.ids)
      if (next.has(a.id)) next.delete(a.id)
      else next.add(a.id)
      selection.set(next)
    } else onOpen(i)
  }

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const imgSize = cell * dpr > 380 ? 'preview' : 'thumbnail'
  const cells: ReactNode[] = []
  if (cell > 0) {
    for (let i = first; i <= last; i++) {
      const row = Math.floor(i / cols)
      const col = i % cols
      const a = source.assetAt(i)
      cells.push(
        <Cell
          key={i}
          index={i}
          asset={a}
          x={col * (cell + GAP)}
          y={topInset + row * rowH}
          size={cell}
          imgSize={imgSize}
          small={cols >= 9}
          selecting={!!selection?.active}
          selected={!!a && !!selection?.ids.has(a.id)}
        />,
      )
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain"
      style={{ scrollbarGutter: 'auto' }}
    >
      <div
        ref={contentRef}
        className="relative w-full"
        style={{ height: contentH, touchAction: selection?.active ? 'pan-y' : undefined }}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {header && <div className="absolute inset-x-0 top-0">{header}</div>}
        {cells}
        {total === 0 && empty}
        {footer && (
          <div className="absolute inset-x-0 flex items-center justify-center" style={{ top: contentH - bottomInset - footerH, height: footerH }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

const Cell = memo(function Cell({
  index,
  asset,
  x,
  y,
  size,
  imgSize,
  small,
  selecting,
  selected,
}: {
  index: number
  asset: TimelineAsset | undefined
  x: number
  y: number
  size: number
  imgSize: 'thumbnail' | 'preview'
  small: boolean
  selecting: boolean
  selected: boolean
}) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const ph = asset ? thumbhashUrl(asset.thumbhash) : undefined
  return (
    <div
      data-index={index}
      className="absolute cursor-pointer overflow-hidden bg-placeholder select-none"
      style={{ transform: `translate3d(${x}px, ${y}px, 0)`, width: size, height: size, left: 0, top: 0 }}
    >
      {asset && (
        <>
          {ph && <img src={ph} alt="" aria-hidden draggable={false} className="absolute inset-0 size-full object-cover" />}
          <img
            src={thumbUrl(asset.id, imgSize, asset.thumbhash)}
            alt=""
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(asset.id)}
            data-loaded={loaded === asset.id ? '' : undefined}
            className="fade-img absolute inset-0 size-full object-cover"
          />
          {!small && (asset.isFavorite || !asset.isImage) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-8 items-end justify-between bg-gradient-to-t from-black/35 to-transparent px-1.5 pb-1 text-white">
              <span>{asset.isFavorite && <Heart className="size-3.5 fill-white drop-shadow" strokeWidth={0} />}</span>
              <span className="text-[12px] font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]">
                {!asset.isImage && formatDurationMs(asset.duration)}
              </span>
            </div>
          )}
          {selecting && (
            <>
              {selected && <div className="absolute inset-0 bg-white/25" />}
              <div
                className={cn(
                  'absolute right-1 bottom-1 flex size-[22px] items-center justify-center rounded-full border-[1.5px] border-white shadow',
                  selected ? 'bg-accent' : 'bg-black/10',
                )}
              >
                {selected && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
})
