import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { StickerSkeleton } from '@/components/ui/sticker-skeleton'
import { cn } from '@/lib/utils'
import { MediaCard } from './MediaCard'

type Props = {
  title: string
  items: BaseItemDto[] | undefined
  isLoading?: boolean
  shape?: 'poster' | 'thumb'
  /** Turns the heading into a link, with the chevron as its affordance. */
  seeAllTo?: string
}

/**
 * A titled row that scrolls. Arrows appear on hover and page by a viewport of
 * track, so a click always lands on a fresh set instead of nudging one card.
 */
export function MediaRow({ title, items, isLoading, shape = 'poster', seeAllTo }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  if (!isLoading && !items?.length) return null

  const page = (direction: 1 | -1) => {
    const track = trackRef.current
    if (!track) return
    track.scrollBy({ left: direction * track.clientWidth * 0.9, behavior: 'smooth' })
  }

  const width = shape === 'thumb' ? 'w-64' : 'w-40'

  return (
    <section className="group/row flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SectionHeading to={seeAllTo}>{title}</SectionHeading>
        <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
          <Arrow label={`Scroll ${title} left`} onClick={() => page(-1)}>
            <ChevronLeft className="size-4" />
          </Arrow>
          <Arrow label={`Scroll ${title} right`} onClick={() => page(1)}>
            <ChevronRight className="size-4" />
          </Arrow>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth no-scrollbar"
      >
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <StickerSkeleton
                key={i}
                shape={shape === 'thumb' ? 'video' : 'poster'}
                delay={i * 80}
                className={cn(width, 'shrink-0 rounded-lg')}
              />
            ))
          : items?.map((item) => (
              <MediaCard
                key={item.Id}
                item={item}
                shape={shape}
                className={cn(width, 'shrink-0 snap-start')}
              />
            ))}
      </div>
    </section>
  )
}

/**
 * Section headings are the only navigation inside the page. A heading that
 * leads somewhere carries a chevron and reveals it on hover; one that does not
 * is plain text at the same size, so the rhythm of the page never breaks.
 */
export function SectionHeading({ to, children }: { to?: string; children: React.ReactNode }) {
  if (!to) return <h2 className="text-base font-semibold">{children}</h2>

  return (
    <h2 className="text-base font-semibold">
      <Link to={to} className="group/heading inline-flex items-center gap-1 hover:text-foreground">
        {children}
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover/heading:translate-x-0.5" />
      </Link>
    </h2>
  )
}

function Arrow({
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
      className="grid size-7 place-items-center rounded-pill bg-surface-2 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
    >
      {children}
    </button>
  )
}
