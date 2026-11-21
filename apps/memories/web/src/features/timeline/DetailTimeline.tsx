import { useCallback, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Loader2 } from 'lucide-react'
import type { TimelineFilter } from '@/lib/api/types'
import { GlassButton } from '@/components/Glass'
import { useViewer } from '@/features/viewer/ViewerProvider'
import { formatCount } from '@/lib/format'
import { TimelineGrid } from './TimelineGrid'
import { SelectionBar } from './SelectionBar'
import { useTimelineStore } from './useTimelineStore'

const HEADER_H = 140

/** Album / Person / Favorites / Utilities: the timeline grid with a title header. */
export function DetailTimeline({
  filter,
  title,
  subtitle,
  avatar,
  trashMode,
  startAtEnd = false,
  emptyText = 'No photos or videos',
}: {
  filter: TimelineFilter
  title: string
  subtitle?: string
  avatar?: ReactNode
  trashMode?: boolean
  startAtEnd?: boolean
  emptyText?: string
}) {
  const navigate = useNavigate()
  const store = useTimelineStore(filter)
  const viewer = useViewer()
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scrolled, setScrolled] = useState(false)
  const onVisible = useCallback((_f: number, _l: number, st: number) => setScrolled(st > HEADER_H - 60), [])

  const header = (
    <div className="flex items-end gap-3 px-4 pb-3" style={{ height: HEADER_H, paddingTop: 'env(safe-area-inset-top)' }}>
      {avatar}
      <div className="min-w-0">
        <h1 className="large-title truncate">{title}</h1>
        <p className="text-[15px] text-label-2">
          {subtitle ?? (store.status === 'ready' ? `${formatCount(store.total)} item${store.total === 1 ? '' : 's'}` : ' ')}
        </p>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-bg">
      <TimelineGrid
        source={store}
        memory={store.ui}
        topInset={HEADER_H}
        bottomInset={110}
        header={header}
        startAtEnd={startAtEnd}
        onOpen={(i) => viewer.open(store, i)}
        selection={{ active: selecting, ids: selected, set: setSelected }}
        onVisible={onVisible}
        empty={
          store.status === 'ready' ? (
            <div className="absolute inset-x-0 text-center text-label-2" style={{ top: HEADER_H + 80 }}>
              {emptyText}
            </div>
          ) : store.status === 'error' ? (
            <div className="absolute inset-x-0 text-center text-destructive" style={{ top: HEADER_H + 80 }}>
              {store.error}
            </div>
          ) : (
            <div className="absolute inset-x-0 flex justify-center text-label-2" style={{ top: HEADER_H + 80 }}>
              <Loader2 className="size-6 animate-spin" />
            </div>
          )
        }
      />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-3 pb-6 transition-[background]"
        style={{ paddingTop: 'max(10px, env(safe-area-inset-top))', background: scrolled ? 'var(--scrim)' : 'transparent' }}
      >
        <GlassButton round aria-label="Back" className="pointer-events-auto" onClick={() => navigate(-1)}>
          <ChevronLeft className="size-6" />
        </GlassButton>
        <div className={`truncate text-[17px] font-semibold transition-opacity ${scrolled ? 'opacity-100' : 'opacity-0'}`}>{title}</div>
        <GlassButton
          className="pointer-events-auto"
          active={selecting}
          onClick={() => {
            setSelecting((s) => !s)
            setSelected(new Set())
          }}
        >
          {selecting ? 'Cancel' : 'Select'}
        </GlassButton>
      </div>
      {selecting && <SelectionBar source={store} ids={selected} trashMode={trashMode} onDone={() => { setSelecting(false); setSelected(new Set()) }} />}
    </div>
  )
}
