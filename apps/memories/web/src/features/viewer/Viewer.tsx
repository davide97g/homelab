import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Heart, Info, Share, Trash2 } from 'lucide-react'
import { api, playbackUrl, thumbUrl } from '@/lib/api/client'
import { thumbhashUrl } from '@/lib/thumbhash'
import { formatDay, formatTime, localDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { AssetSource, TimelineAsset } from '@/features/timeline/store'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { InfoPanel } from './InfoPanel'
import { shareAsset, useAssetActions } from './actions'

interface Props {
  source: AssetSource
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}

interface Zoom {
  s: number
  x: number
  y: number
}
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 }

export default function Viewer({ source, index, onIndex, onClose }: Props) {
  useSyncExternalStore(source.subscribe, source.getVersion)
  const total = source.total
  const i = Math.min(index, total - 1)
  const asset = source.assetAt(i)
  const prev = source.assetAt(i - 1)
  const next = source.assetAt(i + 1)

  const [chrome, setChrome] = useState(true)
  const [info, setInfo] = useState(false)
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM)
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [animate, setAnimate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const actions = useAssetActions(source)

  useEffect(() => {
    source.ensure(i - 40, i + 40)
  }, [source, i])
  useEffect(() => {
    if (total === 0) onClose()
    else if (index > total - 1) onIndex(total - 1)
  }, [total, index, onClose, onIndex])
  useEffect(() => {
    setZoom(NO_ZOOM)
    setLive(false)
  }, [asset?.id])

  // Lock page scroll behind the overlay.
  useLayoutEffect(() => {
    const o = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = o
    }
  }, [])

  const detail = useQuery({ queryKey: ['asset', asset?.id], queryFn: () => api.asset(asset!.id), enabled: !!asset })

  const go = useCallback(
    (dir: 1 | -1, fromDx = 0) => {
      const target = i + dir
      if (target < 0 || target >= total) {
        setAnimate(true)
        setDx(0)
        return
      }
      const w = stageRef.current?.clientWidth ?? window.innerWidth
      // Keep visual continuity: the incoming slide is where it was, then eases to 0.
      setAnimate(false)
      setDx(fromDx + dir * w)
      onIndex(target)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnimate(true)
          setDx(0)
        }),
      )
    },
    [i, total, onIndex],
  )

  const toggleFavorite = useCallback(() => {
    if (asset) actions.setFavorite([asset.id], !asset.isFavorite).catch((e) => setError(String(e.message ?? e)))
  }, [asset, actions])

  const doDelete = useCallback(async () => {
    if (!asset) return
    setConfirmDelete(false)
    try {
      await actions.trash([asset.id])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [asset, actions])

  // ---- keyboard -----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'Escape') {
        if (confirmDelete) setConfirmDelete(false)
        else if (info) setInfo(false)
        else onClose()
      }
      else if (e.key === 'f') toggleFavorite()
      else if (e.key === 'i') setInfo((v) => !v)
      else if (e.key === 'Delete' || e.key === 'Backspace') setConfirmDelete(true)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, toggleFavorite, info, confirmDelete])

  // ---- gestures -------------------------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const g = useRef<{
    sx: number
    sy: number
    t: number
    mode: 'h' | 'v' | 'pan' | 'pinch' | null
    z0: Zoom
    pd: number
    moved: boolean
  } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const tapTimer = useRef<number | undefined>(undefined)
  const pressTimer = useRef<number | undefined>(undefined)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const center = () => {
    const r = stageRef.current!.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-gesture]')) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (pointers.current.size === 1) {
      g.current = { sx: e.clientX, sy: e.clientY, t: Date.now(), mode: null, z0: zoomRef.current, pd: 0, moved: false }
      if (e.pointerType === 'touch' && asset?.livePhotoVideoId) {
        pressTimer.current = window.setTimeout(() => setLive(true), 350)
      }
    } else if (pointers.current.size === 2 && g.current) {
      const [a, b] = [...pointers.current.values()]
      g.current.mode = 'pinch'
      g.current.pd = Math.hypot(a.x - b.x, a.y - b.y)
      g.current.z0 = zoomRef.current
      setDx(0)
      setDy(0)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current
    if (!s || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const mx = e.clientX - s.sx
    const my = e.clientY - s.sy
    if (Math.abs(mx) + Math.abs(my) > 8) {
      s.moved = true
      window.clearTimeout(pressTimer.current)
    }
    if (s.mode === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const ns = Math.max(1, Math.min(6, (s.z0.s * d) / s.pd))
      const { cx, cy } = center()
      const mxp = (a.x + b.x) / 2 - cx
      const myp = (a.y + b.y) / 2 - cy
      const k = ns / s.z0.s
      setZoom({ s: ns, x: mxp - (mxp - s.z0.x) * k, y: myp - (myp - s.z0.y) * k })
      return
    }
    if (!s.moved) return
    if (s.z0.s > 1) {
      s.mode = 'pan'
      setZoom({ ...s.z0, x: s.z0.x + mx, y: s.z0.y + my })
      return
    }
    if (!s.mode) s.mode = Math.abs(mx) > Math.abs(my) ? 'h' : my > 0 ? 'v' : 'h'
    setAnimate(false)
    if (s.mode === 'h') setDx(mx)
    else if (s.mode === 'v') setDy(Math.max(0, my))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    window.clearTimeout(pressTimer.current)
    if (e.pointerType === 'touch') setLive(false)
    const s = g.current
    if (!s || pointers.current.size > 0) return
    g.current = null
    const w = stageRef.current?.clientWidth ?? window.innerWidth
    const dt = Date.now() - s.t
    if (s.mode === 'h') {
      const v = dx / Math.max(dt, 1)
      if (dx < -w * 0.18 || v < -0.5) go(1, dx)
      else if (dx > w * 0.18 || v > 0.5) go(-1, dx)
      else {
        setAnimate(true)
        setDx(0)
      }
      return
    }
    if (s.mode === 'v') {
      if (dy > 110) onClose()
      else {
        setAnimate(true)
        setDy(0)
      }
      return
    }
    if (s.mode === 'pinch' || s.mode === 'pan') {
      if (zoomRef.current.s <= 1.02) setZoom(NO_ZOOM)
      return
    }
    if (s.moved || dt > 500) return
    // Tap or double tap.
    const now = Date.now()
    const lt = lastTap.current
    if (lt && now - lt.t < 300 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
      window.clearTimeout(tapTimer.current)
      lastTap.current = null
      if (!asset?.isImage) return
      if (zoomRef.current.s > 1) setZoom(NO_ZOOM)
      else {
        const { cx, cy } = center()
        const k = 2.5
        setZoom({ s: k, x: -(e.clientX - cx) * (k - 1), y: -(e.clientY - cy) * (k - 1) })
      }
      return
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY }
    tapTimer.current = window.setTimeout(() => setChrome((c) => !c), 300)
  }

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!asset?.isImage) return
      e.preventDefault()
      const z = zoomRef.current
      const ns = Math.max(1, Math.min(6, z.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))))
      if (ns === 1) return setZoom(NO_ZOOM)
      const { cx, cy } = center()
      const mx = e.clientX - cx
      const my = e.clientY - cy
      const k = ns / z.s
      setZoom({ s: ns, x: mx - (mx - z.x) * k, y: my - (my - z.y) * k })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [asset?.isImage])

  if (!asset) return <div className="fixed inset-0 z-50 bg-black" />

  const when = localDate(asset.fileCreatedAt, asset.localOffsetHours)
  const place = [detail.data?.exifInfo?.city ?? asset.city, detail.data?.exifInfo?.country ?? asset.country].filter(Boolean).join(', ')
  const dismiss = Math.min(1, dy / 400)
  const slideStyle = (k: number) => ({
    transform: `translate3d(calc(${k * 100}% + ${dx}px), ${dy}px, 0) scale(${k === 0 ? 1 - dismiss * 0.35 : 1})`,
    transition: animate ? 'transform 280ms cubic-bezier(.2,.8,.2,1)' : 'none',
  })

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black text-white"
      style={{ backgroundColor: `rgba(0,0,0,${1 - dismiss})`, animation: 'fade-in 160ms ease-out' }}
      role="dialog"
      aria-label="Viewer"
    >
      <div className={cn('relative flex-1 overflow-hidden transition-[height]', info && 'max-lg:h-[42%] max-lg:flex-none max-lg:w-full')}>
        <div
          ref={stageRef}
          className="absolute inset-0 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {prev && (
            <div className="absolute inset-0" style={slideStyle(-1)}>
              <Media asset={prev} current={false} />
            </div>
          )}
          <div className="absolute inset-0" style={slideStyle(0)}>
            <div
              className="absolute inset-0"
              style={{
                transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`,
                transition: g.current ? 'none' : 'transform 200ms ease-out',
              }}
            >
              <Media asset={asset} current live={live} />
            </div>
          </div>
          {next && (
            <div className="absolute inset-0" style={slideStyle(1)}>
              <Media asset={next} current={false} />
            </div>
          )}
        </div>

        {/* top chrome */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/50 to-transparent px-3 pb-8 transition-opacity duration-200',
            chrome && dy === 0 ? 'opacity-100' : 'opacity-0',
          )}
          style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
        >
          <button data-no-gesture aria-label="Back" onClick={onClose} className="glass-dark pointer-events-auto flex size-11 items-center justify-center rounded-full">
            <ChevronLeft className="size-6" />
          </button>
          <div className="min-w-0 flex-1 pt-1 text-center">
            <div className="truncate text-[15px] font-semibold">
              {formatDay(when)} · {formatTime(when)}
            </div>
            {place && <div className="truncate text-[12px] text-white/70">{place}</div>}
          </div>
          {asset.livePhotoVideoId ? (
            <button
              data-no-gesture
              onPointerEnter={(e) => e.pointerType === 'mouse' && setLive(true)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setLive(false)}
              onClick={() => setLive((v) => !v)}
              className="glass-dark pointer-events-auto flex h-11 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold tracking-wider"
            >
              <span className={cn('inline-block size-3.5 rounded-full border-2 border-white', live && 'bg-white')} />
              LIVE
            </button>
          ) : (
            <span className="size-11" />
          )}
        </div>

        {/* desktop arrows */}
        {chrome && (
          <>
            {i > 0 && (
              <button data-no-gesture aria-label="Previous" onClick={() => go(-1)} className="glass-dark absolute top-1/2 left-4 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full md:flex">
                <ChevronLeft className="size-6" />
              </button>
            )}
            {i < total - 1 && (
              <button data-no-gesture aria-label="Next" onClick={() => go(1)} className="glass-dark absolute top-1/2 right-4 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full md:flex">
                <ChevronRight className="size-6" />
              </button>
            )}
          </>
        )}

        {/* bottom chrome: filmstrip + toolbar */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/50 to-transparent px-3 pt-10 transition-opacity duration-200',
            chrome && dy === 0 && !info ? 'opacity-100' : 'opacity-0',
          )}
          style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
        >
          <Filmstrip source={source} index={i} onPick={(k) => onIndex(k)} />
          <div data-no-gesture className="glass-dark pointer-events-auto flex h-[54px] items-center gap-1 rounded-full px-2">
            <ToolButton label="Share" onClick={() => shareAsset(asset.id, detail.data?.originalFileName)}>
              <Share className="size-[22px]" />
            </ToolButton>
            <ToolButton label={asset.isFavorite ? 'Unfavorite' : 'Favorite'} onClick={toggleFavorite}>
              <Heart className={cn('size-[22px]', asset.isFavorite && 'fill-white')} />
            </ToolButton>
            <ToolButton label="Info" onClick={() => setInfo(true)}>
              <Info className="size-[22px]" />
            </ToolButton>
            <ToolButton label="Delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-[22px]" />
            </ToolButton>
          </div>
        </div>

        {error && (
          <button data-no-gesture onClick={() => setError(null)} className="glass-dark absolute top-20 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm">
            {error}
          </button>
        )}
      </div>

      {info && (
        <InfoPanel
          asset={asset}
          detail={detail.data}
          loading={detail.isLoading}
          onClose={() => setInfo(false)}
          onFavorite={toggleFavorite}
        />
      )}

      {confirmDelete && (
        <ConfirmSheet
          dark
          message="This photo will be moved to Recently Deleted. It is removed permanently after 30 days."
          action={asset.isImage ? 'Delete Photo' : 'Delete Video'}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="flex size-11 items-center justify-center rounded-full transition active:scale-90 hover:bg-white/10">
      {children}
    </button>
  )
}

/** One slide: preview image (fit), or video, or live-photo motion over the still. */
function Media({ asset, current, live }: { asset: TimelineAsset; current: boolean; live?: boolean }) {
  const [loaded, setLoaded] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const ph = thumbhashUrl(asset.thumbhash)
  // Fit box for the placeholder at the asset's ratio.
  const box = { aspectRatio: String(asset.ratio), maxWidth: '100%', maxHeight: '100%', width: asset.ratio >= 1 ? '100%' : 'auto', height: asset.ratio >= 1 ? 'auto' : '100%' }
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative" style={box}>
        {ph && !loaded && <img src={ph} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />}
        {!asset.isImage && current && !videoError ? (
          <video
            key={asset.id}
            src={playbackUrl(asset.id)}
            poster={thumbUrl(asset.id, 'preview', asset.thumbhash)}
            controls
            autoPlay
            playsInline
            onError={() => setVideoError(true)}
            className="absolute inset-0 size-full bg-black object-contain"
          />
        ) : (
          <img
            key={asset.id}
            src={thumbUrl(asset.id, 'preview', asset.thumbhash)}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            data-loaded={loaded ? '' : undefined}
            className="fade-img absolute inset-0 size-full object-contain"
          />
        )}
        {current && live && asset.livePhotoVideoId && (
          <video
            src={playbackUrl(asset.livePhotoVideoId)}
            autoPlay
            muted
            playsInline
            loop
            className="absolute inset-0 size-full object-contain"
            onError={(e) => ((e.target as HTMLVideoElement).style.display = 'none')}
          />
        )}
        {!asset.isImage && current && videoError && (
          <div className="absolute inset-x-0 bottom-4 text-center text-sm text-white/80">Can’t play this video here.</div>
        )}
      </div>
    </div>
  )
}

function Filmstrip({ source, index, onPick }: { source: AssetSource; index: number; onPick: (i: number) => void }) {
  const R = 14
  const W = 30
  const items: { k: number; a: TimelineAsset | undefined }[] = []
  for (let k = Math.max(0, index - R); k <= Math.min(source.total - 1, index + R); k++) items.push({ k, a: source.assetAt(k) })
  const before = Math.min(R, index)
  return (
    <div data-no-gesture className="pointer-events-auto relative h-11 w-full max-w-[640px] overflow-hidden">
      <div
        className="absolute top-0 left-1/2 flex h-full items-center gap-[2px] transition-transform duration-200"
        style={{ transform: `translateX(${-(before * (W + 2) + 26)}px)` }}
      >
        {items.map(({ k, a }) => (
          <button
            key={a?.id ?? k}
            aria-label={`Item ${k + 1}`}
            onClick={() => onPick(k)}
            className={cn('shrink-0 overflow-hidden rounded-[3px] bg-white/10 transition-all', k === index ? 'mx-1 h-11 w-11' : 'h-9')}
            style={k === index ? undefined : { width: W }}
          >
            {a && <img src={thumbUrl(a.id, 'thumbnail', a.thumbhash)} alt="" className="size-full object-cover" draggable={false} />}
          </button>
        ))}
      </div>
    </div>
  )
}
