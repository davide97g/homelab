import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { MediaCard } from './MediaCard'

type Props = {
  title: string
  items: BaseItemDto[] | undefined
  isLoading?: boolean
  shape?: 'poster' | 'thumb'
  /** Renders a "See all" link next to the heading. */
  seeAllTo?: string
}

/**
 * A titled, snapping carousel. Arrows page by a viewport of track rather than
 * by one card, so a click always lands on a fresh set instead of nudging.
 */
export function MediaRow({ title, items, isLoading, shape = 'poster', seeAllTo }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  if (!isLoading && !items?.length) return null

  const page = (direction: 1 | -1) => {
    const track = trackRef.current
    if (!track) return
    track.scrollBy({ left: direction * track.clientWidth * 0.9, behavior: 'smooth' })
  }

  const width = shape === 'thumb' ? 'w-[17.5rem]' : 'w-[10.5rem]'

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {seeAllTo && (
          <Link
            to={seeAllTo}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary-soft"
          >
            See all
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ArrowButton label={`Scroll ${title} left`} onClick={() => page(-1)}>
            <ChevronLeft className="size-4" />
          </ArrowButton>
          <ArrowButton label={`Scroll ${title} right`} onClick={() => page(1)}>
            <ChevronRight className="size-4" />
          </ArrowButton>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-1 no-scrollbar"
      >
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <StickerSkeleton
                key={i}
                shape={shape === 'thumb' ? 'video' : 'poster'}
                delay={i * 90}
                className={`${width} shrink-0 rounded-2xl`}
              />
            ))
          : items?.map((item) => (
              <MediaCard key={item.Id} item={item} shape={shape} className={`${width} snap-start`} />
            ))}
      </div>
    </section>
  )
}

function ArrowButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-9 place-items-center rounded-pill bg-surface-2/70 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
    >
      {children}
    </button>
  )
}
