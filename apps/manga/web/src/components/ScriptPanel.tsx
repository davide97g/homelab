import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { X } from 'lucide-react'
import type { ScriptLine, ScriptPage } from '@/lib/script/types'

// Who says what on the page being read. Read-along, not a replacement for the
// page: it sits beside it (bottom sheet on a phone) and a tapped line outlines
// its bubble on the page.
export function ScriptPanel({
  page,
  pageNumber,
  selected,
  onSelect,
  onClose,
}: {
  page: ScriptPage | undefined
  pageNumber: number
  selected: number | null
  onSelect: (order: number | null) => void
  onClose: () => void
}) {
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    list.current?.scrollTo({ top: 0 })
  }, [page?.index])

  const lines = page?.lines ?? []
  return (
    <aside
      aria-label="Script"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={clsx(
        'absolute inset-x-0 bottom-0 z-20 flex h-[42dvh] flex-col border-t border-sheet/10 bg-night-2 text-sheet',
        'lg:inset-y-0 lg:right-0 lg:left-auto lg:h-auto lg:w-96 lg:border-t-0 lg:border-l',
      )}
    >
      <div className="flex items-center gap-2 px-5 pt-4 pb-2 lg:pt-[max(1.25rem,env(safe-area-inset-top))]">
        <p className="display flex-1 text-[1.05rem] font-semibold">
          Page {pageNumber}
          <span className="ml-2 text-[0.85rem] font-normal text-sheet/50">
            {lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : 'no text'}
          </span>
        </p>
        <button onClick={onClose} aria-label="Close script" className="rounded-full p-2 hover:bg-night">
          <X className="size-4" strokeWidth={2.4} />
        </button>
      </div>
      <ol ref={list} className="no-scrollbar flex-1 overflow-y-auto px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {lines.map((l) => (
          <li key={l.order}>
            <button
              onClick={() => onSelect(selected === l.order ? null : l.order)}
              disabled={!l.bbox}
              aria-pressed={selected === l.order}
              className={clsx(
                'w-full rounded-xl px-3 py-2 text-left transition',
                l.bbox && 'hover:bg-night',
                selected === l.order && 'bg-night ring-1 ring-sheet/30',
              )}
            >
              <Line line={l} />
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}

function Line({ line }: { line: ScriptLine }) {
  if (line.type === 'sfx' || line.type === 'sign') {
    return (
      <p className="text-[0.85rem] text-sheet/45">
        <span className="mr-1.5 text-[0.7rem] tracking-wider uppercase">{line.type}</span>
        {line.text}
      </p>
    )
  }
  if (line.type === 'narration' || line.type === 'caption') {
    return <p className="text-[0.95rem] leading-snug text-sheet/75 italic">{line.text}</p>
  }
  const unknown = !line.speaker || line.speaker.startsWith('Unknown')
  return (
    <>
      <p className={clsx('display text-[0.85rem] font-semibold', unknown ? 'text-sheet/50' : 'text-kraft')}>
        {unknown ? (line.speaker.replace(/^Unknown:\s*/, '') || 'Someone') : line.speaker}
        {line.type === 'thought' && <span className="ml-1.5 font-normal text-sheet/50">thinking</span>}
      </p>
      <p className="text-[0.95rem] leading-snug">{line.text}</p>
    </>
  )
}

/** The outline of a selected line's bubble, over a page drawn with object-contain in `box`. */
export function BubbleOutline({
  page,
  order,
  box,
}: {
  page: ScriptPage | undefined
  order: number | null
  box: { width: number; height: number } | null
}) {
  const line = order === null ? undefined : page?.lines.find((l) => l.order === order)
  if (!page || !line?.bbox || !box) return null
  const scale = Math.min(box.width / page.width, box.height / page.height)
  const left = (box.width - page.width * scale) / 2
  const top = (box.height - page.height * scale) / 2
  const [x1, y1, x2, y2] = line.bbox
  const pad = 6
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-2xl border-[3px] border-kraft shadow-[0_0_0_9999px_var(--scrim)] transition-all duration-200"
      style={{
        left: left + x1 * scale - pad,
        top: top + y1 * scale - pad,
        width: (x2 - x1) * scale + 2 * pad,
        height: (y2 - y1) * scale + 2 * pad,
      }}
    />
  )
}
