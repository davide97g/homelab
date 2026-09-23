import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { clsx } from 'clsx'
import { adjacentChapter, saveProgress, useChapterInfo, useChapterProgress } from '@/lib/kavita/queries'
import { pageImage } from '@/lib/kavita/images'
import { getSession } from '@/lib/kavita/client'
import type { ChapterInfo, Progress } from '@/lib/kavita/types'
import { Bubble, Spinner } from '@/components/ui'

type Mode = 'rtl' | 'ltr' | 'scroll'
const MODES: { id: Mode; label: string }[] = [
  { id: 'rtl', label: 'Right to left' },
  { id: 'ltr', label: 'Left to right' },
  { id: 'scroll', label: 'Scroll' },
]

// Reading direction is a per-series habit (manga right to left, webtoons
// scrolled), remembered on this device only.
function useMode(seriesId: number): [Mode, (m: Mode) => void] {
  const key = `yomu.mode.${seriesId}`
  const read = (): Mode => {
    try {
      return (localStorage.getItem(key) as Mode) || 'rtl'
    } catch {
      return 'rtl'
    }
  }
  const [mode, setMode] = useState<Mode>(read)
  const set = (m: Mode) => {
    setMode(m)
    try {
      localStorage.setItem(key, m)
    } catch {
      // not persisted; fine
    }
  }
  return [mode, set]
}

export function ReaderRoute() {
  const chapterId = Number(useParams().chapterId)
  const info = useChapterInfo(chapterId)
  const progress = useChapterProgress(chapterId)

  if (info.isError) {
    return (
      <Shell>
        <Bubble className="px-6 py-4 text-ink">This chapter won't open. It may have been moved or deleted.</Bubble>
      </Shell>
    )
  }
  if (!info.data || progress.isPending) {
    return (
      <Shell>
        <Spinner className="size-6 text-sheet/70" />
      </Shell>
    )
  }
  const saved = progress.data?.pageNum ?? 0
  const start = saved >= info.data.pages ? 0 : saved
  return <Reader key={chapterId} chapterId={chapterId} info={info.data} start={start} />
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-night px-4">{children}</div>
}

function Reader({ chapterId, info, start }: { chapterId: number; info: ChapterInfo; start: number }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [mode, setMode] = useMode(info.seriesId)
  const [page, setPage] = useState(start) // 0-based; === pages means "finished"
  const [chrome, setChrome] = useState(true)
  const [next, setNext] = useState<number | null | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pages = info.pages
  const done = page >= pages
  const seriesPath = `/series/${info.seriesId}`

  // Progress: Kavita counts pages read as the current page index, and the
  // chapter as read once that reaches the page count.
  const pending = useRef<Progress | null>(null)
  const flush = useCallback((keepalive = false) => {
    const p = pending.current
    if (!p) return
    pending.current = null
    if (keepalive) {
      const s = getSession()
      void fetch('/api/reader/progress', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json', ...(s ? { authorization: `Bearer ${s.token}` } : {}) },
        body: JSON.stringify(p),
      })
    } else void saveProgress(p).catch(() => {})
  }, [])

  useEffect(() => {
    const pageNum = page >= pages - 1 ? pages : page
    pending.current = { chapterId, pageNum, seriesId: info.seriesId, volumeId: info.volumeId, libraryId: info.libraryId }
    const t = setTimeout(() => flush(), 700)
    return () => clearTimeout(t)
  }, [page, pages, chapterId, info, flush])

  useEffect(() => {
    const leave = () => flush(true)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      flush(true)
      void qc.invalidateQueries({ queryKey: ['series'] })
      void qc.invalidateQueries({ queryKey: ['on-deck'] })
      void qc.invalidateQueries({ queryKey: ['library'] })
    }
  }, [flush, qc])

  // Near the end, find out what comes next.
  useEffect(() => {
    if (next !== undefined || page < pages - 2) return
    adjacentChapter('next', info.seriesId, info.volumeId, chapterId)
      .then((id) => setNext(id > 0 ? id : null))
      .catch(() => setNext(null))
  }, [page, pages, next, info, chapterId])

  // Keep the next two pages warm.
  useEffect(() => {
    if (mode === 'scroll') return
    for (const p of [page + 1, page + 2]) if (p < pages) new Image().src = pageImage(chapterId, p)
  }, [page, pages, chapterId, mode])

  const poke = useCallback(() => {
    setChrome(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChrome(false), 2800)
  }, [])
  useEffect(() => {
    poke()
    return () => clearTimeout(hideTimer.current)
  }, [poke])

  const forward = useCallback(() => setPage((p) => Math.min(p + 1, pages)), [pages])
  const back = useCallback(() => setPage((p) => Math.max(p - 1, 0)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') return navigate(seriesPath)
      if (mode === 'scroll') return
      const rtl = mode === 'rtl'
      if (e.key === 'ArrowLeft') (rtl ? forward : back)()
      else if (e.key === 'ArrowRight') (rtl ? back : forward)()
      else if (e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        forward()
      } else if (e.key === 'PageUp') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, forward, back, navigate, seriesPath])

  const title = info.isSpecial ? info.title : `Chapter ${info.chapterNumber}`

  return (
    <div className="fixed inset-0 bg-night text-sheet select-none" onPointerMove={(e) => e.pointerType === 'mouse' && poke()}>
      {mode === 'scroll' ? (
        <ScrollPages chapterId={chapterId} pages={pages} start={start} onPage={setPage} onTap={() => setChrome((c) => !c)}>
          <EndCard inline title={title} next={next} seriesPath={seriesPath} />
        </ScrollPages>
      ) : (
        <PagedView
          chapterId={chapterId}
          page={page}
          pages={pages}
          rtl={mode === 'rtl'}
          onForward={forward}
          onBack={back}
          onTap={() => setChrome((c) => !c)}
        />
      )}

      {done && mode !== 'scroll' && (
        <EndCard title={title} next={next} seriesPath={seriesPath} onBack={back} />
      )}

      {/* Chrome */}
      <div
        className={clsx(
          'pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-night/95 via-night/70 to-transparent pb-10 transition-opacity duration-300',
          chrome || done ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div
          className={clsx(
            'mx-auto flex max-w-5xl items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]',
            chrome || done ? 'pointer-events-auto' : 'pointer-events-none',
          )}
        >
          <Link to={seriesPath} aria-label="Close reader" className="rounded-full p-2 hover:bg-night-2">
            <X className="size-5" strokeWidth={2.4} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="display truncate text-[1.05rem] font-semibold">{info.seriesName}</p>
            <p className="truncate text-[0.85rem] text-sheet/60">{title}</p>
          </div>
          <div role="radiogroup" aria-label="Reading direction" className="flex rounded-full bg-night-2 p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                aria-label={m.label}
                title={m.label}
                onClick={() => setMode(m.id)}
                className={clsx(
                  'rounded-full px-3 py-1.5 text-[0.8rem] transition',
                  mode === m.id ? 'bg-sheet text-ink' : 'text-sheet/70 hover:text-sheet',
                )}
              >
                {m.id === 'rtl' ? <ArrowLeft className="size-4" /> : m.id === 'ltr' ? <ArrowRight className="size-4" /> : 'Scroll'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={clsx(
          'pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-night/95 via-night/70 to-transparent pt-12 transition-opacity duration-300',
          chrome && !done ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div
          className={clsx(
            'mx-auto flex max-w-3xl items-center gap-4 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
            chrome && !done ? 'pointer-events-auto' : 'pointer-events-none',
            mode === 'rtl' && 'flex-row-reverse',
          )}
        >
          <span className="w-14 text-center text-[0.85rem] text-sheet/70 tabular-nums">{Math.min(page + 1, pages)}</span>
          <input
            type="range"
            min={0}
            max={pages - 1}
            value={Math.min(page, pages - 1)}
            onChange={(e) => {
              const p = Number(e.target.value)
              setPage(p)
              if (mode === 'scroll') document.getElementById(`page-${p}`)?.scrollIntoView()
            }}
            aria-label="Page"
            className="scrubber flex-1"
            dir={mode === 'rtl' ? 'rtl' : 'ltr'}
            style={{ '--fill': `${(Math.min(page, pages - 1) / Math.max(pages - 1, 1)) * 100}%` } as CSSProperties}
          />
          <span className="w-14 text-center text-[0.85rem] text-sheet/70 tabular-nums">{pages}</span>
        </div>
      </div>
    </div>
  )
}

function PagedView({
  chapterId,
  page,
  pages,
  rtl,
  onForward,
  onBack,
  onTap,
}: {
  chapterId: number
  page: number
  pages: number
  rtl: boolean
  onForward: () => void
  onBack: () => void
  onTap: () => void
}) {
  const [loaded, setLoaded] = useState<number | null>(null)
  const down = useRef<{ x: number; y: number } | null>(null)
  const shown = Math.min(page, pages - 1)

  // One tap target for the whole screen: outer thirds turn the page (which
  // way depends on direction), the middle third shows or hides the controls.
  const onPointerUp = (e: PointerEvent) => {
    const start = down.current
    down.current = null
    if (!start) return
    const dx = e.clientX - start.x
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
      // Swipe: drag the page the way paper would move.
      const towardsNext = rtl ? dx > 0 : dx < 0
      return towardsNext ? onForward() : onBack()
    }
    const x = e.clientX / window.innerWidth
    if (x > 1 / 3 && x < 2 / 3) return onTap()
    const leftSide = x <= 1 / 3
    if (leftSide === rtl) onForward()
    else onBack()
  }

  return (
    <div
      className="absolute inset-0 grid touch-pan-y place-items-center"
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={onPointerUp}
    >
      {loaded !== shown && <Spinner className="absolute size-6 text-sheet/50" />}
      <img
        key={shown}
        src={pageImage(chapterId, shown)}
        alt={`Page ${shown + 1}`}
        draggable={false}
        onLoad={() => setLoaded(shown)}
        className={clsx(
          'max-h-dvh max-w-full object-contain transition-opacity duration-150',
          loaded === shown ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}

function ScrollPages({
  chapterId,
  pages,
  start,
  onPage,
  onTap,
  children,
}: {
  chapterId: number
  pages: number
  start: number
  onPage: (p: number) => void
  onTap: () => void
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (start > 0) document.getElementById(`page-${start}`)?.scrollIntoView()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) onPage(Number((e.target as HTMLElement).dataset.page))
      },
      { root: root.current, rootMargin: '-45% 0px -45% 0px' },
    )
    root.current?.querySelectorAll('[data-page]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [start, onPage])

  return (
    <div ref={root} className="absolute inset-0 overflow-y-auto" onClick={onTap}>
      <div className="mx-auto max-w-3xl">
        {Array.from({ length: pages }, (_, i) => (
          <img
            key={i}
            id={`page-${i}`}
            data-page={i}
            src={pageImage(chapterId, i)}
            alt={`Page ${i + 1}`}
            loading={Math.abs(i - start) < 3 ? 'eager' : 'lazy'}
            className="block min-h-[40vh] w-full"
          />
        ))}
        <div data-page={pages} onClick={(e) => e.stopPropagation()} className="py-24">
          {children}
        </div>
      </div>
    </div>
  )
}

function EndCard({
  title,
  next,
  seriesPath,
  onBack,
  inline,
}: {
  title: string
  next: number | null | undefined
  seriesPath: string
  onBack?: () => void
  inline?: boolean
}) {
  return (
    <div className={inline ? 'grid place-items-center px-4' : 'absolute inset-0 z-10 grid place-items-center bg-night/85 px-4 backdrop-blur-sm'}>
      <div className="flex flex-col items-center text-center">
        <Bubble className="mb-10 px-7 py-5 text-ink">
          <p className="display text-[1.6rem] leading-tight font-bold">That's {title.toLowerCase()}.</p>
          <p className="mt-1 text-ink-2">{next === null ? 'You’re all caught up on this series.' : 'On to the next one?'}</p>
        </Bubble>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {next ? (
            <Link
              to={`/read/${next}`}
              replace
              className="display rounded-full bg-sheet px-6 py-3 text-[1.05rem] font-semibold text-ink shadow-[3px_4px_0_var(--kraft)] transition hover:-translate-y-px"
            >
              Next chapter
            </Link>
          ) : next === undefined ? (
            <Spinner className="text-sheet/70" />
          ) : null}
          <Link to={seriesPath} className="rounded-full border-2 border-sheet/40 px-5 py-2.5 text-[0.95rem] text-sheet hover:border-sheet">
            Back to the series
          </Link>
        </div>
        {onBack && <button onClick={onBack} className="mt-6 text-[0.85rem] text-sheet/60 underline underline-offset-4 hover:text-sheet">
          Back to the last page
        </button>}
      </div>
    </div>
  )
}
