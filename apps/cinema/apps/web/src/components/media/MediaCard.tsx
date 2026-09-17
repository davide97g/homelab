import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemImageUrl } from '@/lib/jellyfin/images'
import { formatRuntime } from '@/lib/jellyfin/ticks'
import { cn } from '@/lib/utils'

type Props = {
  item: BaseItemDto
  /** 'poster' for browsing, 'thumb' for anything you are mid-way through. */
  shape?: 'poster' | 'thumb'
  className?: string
}

/**
 * Artwork card: the image is the card, the text sits on it. Genre chips and
 * the hover play target come from the reference layout; the progress hairline
 * is ours, because a half-watched film has to say so.
 */
export function MediaCard({ item, shape = 'poster', className }: Props) {
  const { api } = useAuth()
  const isThumb = shape === 'thumb'

  const imageUrl = itemImageUrl(api, item, isThumb ? ImageType.Backdrop : ImageType.Primary, {
    maxWidth: isThumb ? 560 : 360,
  })

  const progress = item.UserData?.PlayedPercentage ?? 0
  const title = item.Type === 'Episode' ? item.SeriesName : item.Name
  const chips =
    item.Type === 'Episode'
      ? [`S${item.ParentIndexNumber} E${item.IndexNumber}`, item.Name].filter(Boolean)
      : (item.Genres?.slice(0, 2) ?? [])
  const corner =
    item.Type === 'Episode'
      ? null
      : [item.ProductionYear, item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : null]
          .filter(Boolean)
          .join(' · ')

  return (
    <Link
      to={`/item/${item.Id}`}
      className={cn(
        'group relative block shrink-0 overflow-hidden rounded-2xl bg-surface-2 shadow-card',
        'outline-none transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease)]',
        'hover:-translate-y-1 hover:shadow-panel focus-visible:ring-2 focus-visible:ring-ring',
        isThumb ? 'aspect-video' : 'aspect-[2/3]',
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-[600ms] ease-[var(--ease)] group-hover:scale-105"
        />
      ) : (
        <span className="grid size-full place-items-center px-3 text-center text-sm text-muted-foreground">
          {title}
        </span>
      )}

      {/* Deep enough that title and chips never sit on bright artwork. */}
      <span className="absolute inset-0 bg-gradient-to-t from-canvas-deep from-5% via-canvas-deep/65 via-40% to-transparent" />

      {corner && (
        <span className="absolute top-2.5 right-2.5 rounded-pill border border-[var(--hairline)] bg-scrim/70 px-2 py-0.5 text-[0.6875rem] font-medium text-foreground/85 backdrop-blur">
          {corner}
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-3">
        <span className="line-clamp-2 text-sm leading-snug font-semibold">{title}</span>
        {!!chips.length && (
          // One line of chips, clipped. Wrapping them stacks the card's text
          // block and pushes the title off the artwork it belongs to.
          <span className="flex gap-1.5 overflow-hidden">
            {chips.map((chip) => (
              <span
                key={chip}
                className="shrink-0 truncate rounded-pill bg-white/10 px-2 py-0.5 text-[0.6875rem] whitespace-nowrap text-foreground/80 backdrop-blur"
              >
                {chip}
              </span>
            ))}
          </span>
        )}
      </span>

      {/* Only mid-watch films get a bar. 0% and 100% are not progress. */}
      {progress > 0 && progress < 100 && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
          <span className="block h-full bg-primary" style={{ width: `${progress}%` }} />
        </span>
      )}

      <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-[var(--duration-base)] group-hover:opacity-100">
        <span className="grid size-12 place-items-center rounded-pill bg-primary text-primary-foreground shadow-primary-glow">
          <Play className="size-5 translate-x-px fill-current" />
        </span>
      </span>
    </Link>
  )
}
