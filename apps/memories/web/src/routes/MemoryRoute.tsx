import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Pause, Play, X } from 'lucide-react'
import { api, thumbUrl } from '@/lib/api/client'
import { thumbhashUrl } from '@/lib/thumbhash'
import { todayIso } from '@/lib/format'

const SLIDE_MS = 5000

/** Full-screen auto-advancing Ken Burns slideshow. */
export default function MemoryRoute() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const today = todayIso()
  const memories = useQuery({ queryKey: ['memories', today], queryFn: () => api.memories(today) })
  const list = useMemo(() => memories.data ?? [], [memories.data])
  const mi = list.findIndex((m) => m.id === id)
  const memory = mi >= 0 ? list[mi] : undefined
  const assets = memory?.assets ?? []
  const [k, setK] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => setK(0), [id])

  const close = useCallback(() => navigate(-1), [navigate])
  const next = useCallback(() => {
    if (k < assets.length - 1) setK(k + 1)
    else if (mi >= 0 && mi < list.length - 1) navigate(`/memories/${list[mi + 1].id}`, { replace: true })
    else close()
  }, [k, assets.length, mi, list, navigate, close])
  const prev = useCallback(() => setK((v) => Math.max(0, v - 1)), [])

  useEffect(() => {
    if (paused || !assets.length) return
    const t = window.setTimeout(next, SLIDE_MS)
    return () => window.clearTimeout(t)
  }, [k, paused, next, assets.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'Escape') close()
      else if (e.key === ' ') setPaused((p) => !p)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, close])

  // Preload the next slide.
  useEffect(() => {
    const n = assets[k + 1]
    if (n) new Image().src = thumbUrl(n.id, 'preview', n.thumbhash)
  }, [assets, k])

  const title = memory ? (memory.type === 'birthday' ? `${memory.data.personName ?? ''}'s Birthday` : 'On This Day') : ''
  const yearsAgo = memory ? new Date().getFullYear() - memory.data.year : 0

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black text-white select-none">
      {assets.map((a, i) =>
        Math.abs(i - k) <= 1 ? (
          <div key={a.id} className="absolute inset-0 transition-opacity duration-1000" style={{ opacity: i === k ? 1 : 0 }}>
            {a.thumbhash && <img src={thumbhashUrl(a.thumbhash)} alt="" className="absolute inset-0 size-full object-cover blur-xl" />}
            <img
              src={thumbUrl(a.id, 'preview', a.thumbhash)}
              alt=""
              className="absolute inset-0 size-full object-cover"
              style={{
                animation: i === k ? `${i % 2 ? 'kenburns-b' : 'kenburns-a'} ${SLIDE_MS + 1200}ms ease-out forwards` : undefined,
                animationPlayState: paused ? 'paused' : 'running',
              }}
            />
          </div>
        ) : null,
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/40" />

      {/* tap zones */}
      <button aria-label="Previous" className="absolute inset-y-0 left-0 w-1/3" onClick={prev} />
      <button aria-label="Next" className="absolute inset-y-0 right-0 w-2/3" onClick={next} />

      <div className="pointer-events-none absolute inset-x-0 top-0 px-3" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
        <div className="flex gap-1">
          {assets.map((a, i) => (
            <div key={a.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                key={`${a.id}-${k}`}
                className="h-full origin-left bg-white"
                style={
                  i < k
                    ? { transform: 'scaleX(1)' }
                    : i === k
                      ? { animation: `progress ${SLIDE_MS}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }
                      : { transform: 'scaleX(0)' }
                }
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[13px] font-semibold opacity-90">{memory ? `${memory.data.year}` : ''}</div>
          <div className="pointer-events-auto flex gap-2">
            <button aria-label={paused ? 'Play' : 'Pause'} onClick={() => setPaused((p) => !p)} className="glass-dark flex size-10 items-center justify-center rounded-full">
              {paused ? <Play className="size-4 fill-white" /> : <Pause className="size-4 fill-white" />}
            </button>
            <button aria-label="Close" onClick={close} className="glass-dark flex size-10 items-center justify-center rounded-full">
              <X className="size-5" />
            </button>
          </div>
        </div>
      </div>

      {memory && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 px-6 transition-opacity duration-700"
          style={{ paddingBottom: 'max(40px, calc(env(safe-area-inset-bottom) + 24px))', opacity: k === 0 ? 1 : 0.0 }}
        >
          <div className="font-display text-[40px] leading-[1.05] font-bold drop-shadow-lg">{title}</div>
          <div className="mt-1 text-[17px] font-semibold opacity-90 drop-shadow">
            {memory.data.year} · {yearsAgo} year{yearsAgo === 1 ? '' : 's'} ago
          </div>
        </div>
      )}

      {memories.isSuccess && !memory && (
        <div className="absolute inset-0 flex items-center justify-center text-white/70">This memory is no longer available.</div>
      )}
    </div>
  )
}
