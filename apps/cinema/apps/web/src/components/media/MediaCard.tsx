import { Link } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { useAuth } from '@/lib/jellyfin/auth'
import { ImageType, itemImageUrl } from '@/lib/jellyfin/images'
import { cn } from '@/lib/utils'
import { displayTitle, factLine } from './item-facts'
import { DotList, KindTag } from './item-meta'

type Props = {
  item: BaseItemDto
  /** 'poster' for browsing, 'thumb' for anything you are mid-way through. */
  shape?: 'poster' | 'thumb'
  /** Fill the row's height instead of imposing an aspect ratio. */
  fill?: boolean
  className?: string
}

/**
 * Artwork with its title on it. No chips, no hover play button: the card is a
 * poster, and the only decoration it earns is a hairline on hover.
 */
export function MediaCard({ item, shape = 'poster', fill, className }: Props) {
  const { api } = useAuth()
  const isThumb = shape === 'thumb'

  const imageUrl = itemImageUrl(api, item, isThumb ? ImageType.Backdrop : ImageType.Primary, {
    maxWidth: isThumb ? 640 : 400,
  })

  const progress = item.UserData?.PlayedPercentage ?? 0
  const title = displayTitle(item)

  return (
    <Link
      to={`/item/${item.Id}`}
      className={cn(
        'group relative block overflow-hidden rounded-lg bg-surface outline-none',
        'ring-1 ring-transparent transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease)]',
        'hover:ring-white/15 focus-visible:ring-foreground',
        fill ? 'h-full' : isThumb ? 'aspect-video' : 'aspect-[2/3]',
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-[600ms] ease-[var(--ease)] group-hover:scale-[1.04]"
        />
      ) : (
        <span className="grid size-full place-items-center px-3 text-center text-sm text-muted-foreground">
          {title}
        </span>
      )}

      <span className="art-scrim absolute inset-0" />

      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3">
        <KindTag item={item} />
        <span className="line-clamp-2 text-sm leading-tight font-semibold">{title}</span>
        {/* A poster is 10rem wide: two genres there truncate to "Science
            Ficti… · Adventu…", which reads as damage. Wide cards get two. */}
        <DotList
          parts={item.Genres?.slice(0, isThumb ? 2 : 1) ?? factLine(item)}
          className="text-[0.6875rem]"
        />
      </span>

      {/* Only mid-watch films get a bar. 0% and 100% are not progress. */}
      {progress > 0 && progress < 100 && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
          <span className="block h-full bg-primary" style={{ width: `${progress}%` }} />
        </span>
      )}
    </Link>
  )
}
