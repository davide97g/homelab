import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ellipsis, Loader2, LogOut, Upload } from 'lucide-react'
import { GlassButton } from '@/components/Glass'
import { Segmented } from '@/components/Segmented'
import { TabBar, TAB_BAR_SPACE } from '@/components/TabBar'
import { TimelineGrid, type GridHandle } from '@/features/timeline/TimelineGrid'
import { MonthsView, YearsView } from '@/features/timeline/MonthsYears'
import { SelectionBar } from '@/features/timeline/SelectionBar'
import { useTimelineStore } from '@/features/timeline/useTimelineStore'
import { useViewer } from '@/features/viewer/ViewerProvider'
import { useAuth } from '@/lib/auth'
import { formatCount, monthYear, parseBucket } from '@/lib/format'
import type { TimelineFilter } from '@/lib/api/types'

type View = 'years' | 'months' | 'all'
const FILTER: TimelineFilter = {}

function loadView(): View {
  try {
    const v = sessionStorage.getItem('memories.libraryView')
    if (v === 'years' || v === 'months' || v === 'all') return v
  } catch {
    /* ignore */
  }
  return 'all'
}

export default function LibraryRoute() {
  const store = useTimelineStore(FILTER)
  const viewer = useViewer()
  const { logout } = useAuth()
  const [view, setViewState] = useState<View>(loadView)
  const [jumpIndex, setJumpIndex] = useState<number | undefined>(undefined)
  const [anchorYear, setAnchorYear] = useState<number | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState(false)
  const [firstVisible, setFirstVisible] = useState(0)
  const gridRef = useRef<GridHandle | null>(null)

  const setView = (v: View) => {
    setViewState(v)
    setSelecting(false)
    try {
      sessionStorage.setItem('memories.libraryView', v)
    } catch {
      /* ignore */
    }
  }

  const onVisible = useCallback((first: number) => setFirstVisible(first), [])
  const handleRef = useCallback((h: GridHandle | null) => {
    gridRef.current = h
  }, [])

  // Floating title: month of the top row + its most likely place.
  const title = useMemo(() => {
    if (!store.buckets.length) return { title: 'Library', sub: '' }
    if (view !== 'all') return { title: 'Library', sub: `${formatCount(store.total)} items` }
    const b = store.buckets[store.bucketIndexAt(firstVisible)]
    const a = store.assetAt(firstVisible)
    return { title: monthYear(b.timeBucket), sub: [a?.city, a?.country].filter(Boolean).join(', ') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, store.buckets, store.getVersion(), firstVisible, view])

  const bottomInset = TAB_BAR_SPACE + 64

  return (
    <div className="fixed inset-0 bg-bg">
      {view === 'all' && (
        <TimelineGrid
          key={`all-${jumpIndex ?? 'mem'}`}
          source={store}
          memory={store.ui}
          startAtEnd
          initialIndex={jumpIndex}
          topInset={0}
          bottomInset={bottomInset}
          onOpen={(i) => viewer.open(store, i)}
          selection={{ active: selecting, ids: selected, set: setSelected }}
          onVisible={onVisible}
          handleRef={handleRef}
          footer={
            store.status === 'ready' ? (
              <span className="text-[13px] font-semibold text-label-2">{formatCount(store.total)} Photos & Videos</span>
            ) : undefined
          }
        />
      )}
      {view === 'months' && (
        <MonthsView
          store={store}
          anchorYear={anchorYear}
          bottomInset={bottomInset}
          onPickMonth={(bi) => {
            setJumpIndex(store.buckets[bi].start)
            setView('all')
          }}
        />
      )}
      {view === 'years' && (
        <YearsView
          store={store}
          bottomInset={bottomInset}
          onPickYear={(y) => {
            setAnchorYear(y)
            setView('months')
          }}
        />
      )}

      {store.status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-label-2">
          {store.status === 'error' ? <span className="text-destructive">{store.error}</span> : <Loader2 className="size-7 animate-spin" />}
        </div>
      )}
      {store.status === 'ready' && store.total === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-label-2">
          <p className="text-[20px] font-semibold text-label">No Photos or Videos</p>
          <Link to="/upload" className="text-accent">
            Upload some
          </Link>
        </div>
      )}

      {/* Top: scrim + floating title + glass actions */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 px-4 pb-10"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', background: 'var(--scrim)' }}
      >
        <div className="min-w-0 pt-1">
          <h1 className="truncate font-display text-[24px] leading-[30px] font-bold tracking-[0.3px] sm:text-[28px] sm:leading-[34px]">{title.title}</h1>
          <p className="h-5 truncate text-[15px] font-medium text-label-2">{title.sub}</p>
        </div>
        <div className="pointer-events-auto relative flex shrink-0 gap-2">
          {view === 'all' && (
            <GlassButton
              active={selecting}
              onClick={() => {
                setSelecting((s) => !s)
                setSelected(new Set())
              }}
            >
              {selecting ? 'Cancel' : 'Select'}
            </GlassButton>
          )}
          <GlassButton round aria-label="More" onClick={() => setMenu((m) => !m)}>
            <Ellipsis className="size-5" />
          </GlassButton>
          {menu && (
            <>
              <div className="fixed inset-0" onClick={() => setMenu(false)} />
              <div className="glass absolute top-12 right-0 w-52 overflow-hidden rounded-[14px] text-[15px]" style={{ animation: 'fade-in 120ms ease-out' }}>
                <Link to="/upload" className="flex items-center justify-between px-4 py-3 hover:bg-fill" onClick={() => setMenu(false)}>
                  Upload <Upload className="size-4" />
                </Link>
                <button className="flex w-full items-center justify-between border-t border-separator px-4 py-3 text-destructive hover:bg-fill" onClick={() => logout()}>
                  Sign Out <LogOut className="size-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {selecting ? (
        <SelectionBar
          source={store}
          ids={selected}
          onDone={() => {
            setSelecting(false)
            setSelected(new Set())
          }}
        />
      ) : (
        <>
          <div className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4" style={{ bottom: `calc(${TAB_BAR_SPACE - 10}px + max(0px, env(safe-area-inset-bottom) - 14px))` }}>
            <Segmented
              className="pointer-events-auto w-full max-w-[300px]"
              value={view}
              onChange={(v) => {
                if (v === 'months') setAnchorYear(view === 'all' ? parseBucket(store.buckets[store.bucketIndexAt(firstVisible)]?.timeBucket ?? '0000').y : null)
                if (v === 'all') setJumpIndex(undefined)
                setView(v)
              }}
              options={[
                { value: 'years', label: 'Years' },
                { value: 'months', label: 'Months' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <TabBar />
        </>
      )}
    </div>
  )
}
